// SPDX-License-Identifier: Apache-2.0
'use strict';

// AWS credentials read from a named profile with `aws configure export-credentials --profile NAME --format process`.
// Two callers use it, with two refresh policies over the same export and parse:
// - `run --aws-profile NAME` (Claude Code arms): profileCredentials, synchronous. A run needs keys that outlast it, so
//   keys that expire within 15 minutes are read again, and a fresh read that still expires that soon stops the run.
// - `judge --aws-export-profile NAME` (opencode backend): makeExportedCredentials, asynchronous. A credential process can
//   hand back the same cached expiry until shortly before it runs out, so a refresh that brings no later expiry keeps
//   the current values and asks again `recheckMs` later; only credentials that have run out with nothing newer stop it.
// Values are held in memory and go only into the environment or scratch HOME of the call that asked. They are never
// logged or put in an error message; every value handed out is listed for scrubbing output files.

const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const REFRESH_WITHIN_MS = 15 * 60 * 1000;
const RECHECK_MS = 60 * 1000;
// One limit for both export calls: an SSO or credential_process refresh can take well over a minute.
const EXPORT_TIMEOUT_MS = 120 * 1000;
const PROFILE_RE = /^[A-Za-z0-9._@+-]{1,128}$/;
// Variables that would make `aws` read something other than the named profile.
const OVERRIDES = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_DEFAULT_PROFILE'];

const isProfileName = (p) => typeof p === 'string' && PROFILE_RE.test(p);
const exportArgs = (profile) => ['configure', 'export-credentials', '--profile', profile, '--format', 'process'];
function exportEnv(baseEnv) {
  const env = { ...baseEnv };
  for (const k of OVERRIDES) delete env[k];
  return env;
}

// The failure names the profile and the last stderr line of the AWS CLI (which names the problem, never a key), or the
// exit when there is no stderr. stdout is never quoted.
function exportFailure(profile, e) {
  const why = (e.stderr ? String(e.stderr) : '').trim().split('\n').filter(Boolean).at(-1)
    ?? (e.killed ? 'timed out' : `exit ${e.status ?? e.code ?? 'unknown'}`);
  return new Error(`aws configure export-credentials --profile ${profile} failed: ${why.slice(0, 300)}`);
}

// The export runs two ways with the same options ({ awsBin, baseEnv, timeoutMs }): the run path reads credentials
// synchronously (profileCredentials), the judge path refreshes them without blocking its event loop (awsExport).

/** Runs the export synchronously and returns its stdout. */
function exportCredentials(profile, { awsBin = 'aws', baseEnv = process.env, timeoutMs = EXPORT_TIMEOUT_MS } = {}) {
  try {
    return execFileSync(awsBin, exportArgs(profile), { env: exportEnv(baseEnv), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
  } catch (e) { throw exportFailure(profile, e); }
}

/** Runs the export asynchronously and resolves its stdout. */
function awsExport(profile, { awsBin = 'aws', baseEnv = process.env, timeoutMs = EXPORT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(awsBin, exportArgs(profile), { env: exportEnv(baseEnv), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(exportFailure(profile, { killed: err.killed, code: err.code, stderr }));
      else resolve(stdout);
    });
  });
}

/** { accessKeyId, secretAccessKey, sessionToken, expiresAt } from the process-format JSON; throws on any other shape. */
function parseExport(stdout, profile) {
  const who = `aws configure export-credentials${profile ? ` --profile ${profile}` : ''}`;
  let v;
  try { v = JSON.parse(stdout); } catch { throw new Error(`${who} did not print JSON`); }
  if (!v || typeof v.AccessKeyId !== 'string' || !v.AccessKeyId || typeof v.SecretAccessKey !== 'string' || !v.SecretAccessKey) {
    throw new Error(`${who} gave no access key pair`);
  }
  const expiresAt = v.Expiration ? Date.parse(v.Expiration) : null;
  if (v.Expiration && !Number.isFinite(expiresAt)) throw new Error(`${who} gave an expiry that is not a date`);
  return { accessKeyId: v.AccessKeyId, secretAccessKey: v.SecretAccessKey, sessionToken: typeof v.SessionToken === 'string' && v.SessionToken ? v.SessionToken : null, expiresAt };
}

/** The AWS_* environment variables for parsed credentials. */
function envVars(c) {
  const vars = { AWS_ACCESS_KEY_ID: c.accessKeyId, AWS_SECRET_ACCESS_KEY: c.secretAccessKey };
  if (c.sessionToken) vars.AWS_SESSION_TOKEN = c.sessionToken;
  return vars;
}

/** The environment variables and the expiry (ms since epoch, or null) from the process-format JSON. */
function parseProcessCredentials(text, profile) {
  const c = parseExport(text, profile);
  return { vars: envVars(c), expiresAt: c.expiresAt };
}

const secretValues = (c) => [c.accessKeyId, c.secretAccessKey, c.sessionToken].filter(Boolean);

/**
 * The run's credential source for `profile`. `current()` returns the variables for the next run, reading the profile
 * again when nothing is cached, when the cached keys carry no expiry, or when they expire within `refreshWithinMs`.
 * `values()` lists every secret value handed out so far, for scrubbing output files.
 */
function profileCredentials(profile, { read = (p) => exportCredentials(p), now = Date.now, refreshWithinMs = REFRESH_WITHIN_MS } = {}) {
  if (!isProfileName(profile)) throw new Error('--aws-profile needs a profile name (letters, digits, . _ @ + -)');
  let cached = null;
  let refreshes = 0;
  const issued = new Set();
  const stale = () => !cached || cached.expiresAt === null || cached.expiresAt - now() < refreshWithinMs;
  return {
    profile,
    current() {
      if (stale()) {
        cached = parseExport(read(profile), profile);
        refreshes++;
        for (const v of secretValues(cached)) issued.add(v);
        if (cached.expiresAt !== null && cached.expiresAt - now() < refreshWithinMs) {
          const mins = Math.max(0, Math.round((cached.expiresAt - now()) / 60000));
          throw new Error(`the credentials of profile ${profile} expire in ${mins} minute(s), too soon for a run; refresh the profile's session and start again`);
        }
      }
      return envVars(cached);
    },
    expiresAt: () => cached?.expiresAt ?? null,
    refreshes: () => refreshes,
    values: () => [...issued],
  };
}

const minutes = (ms) => `${Math.round(ms / 60000)} min`;

/**
 * The judge's credential source: `await current()` resolves { accessKeyId, secretAccessKey, sessionToken, expiresAt }.
 * `secrets()` lists every secret value seen so far, for scrubbing. `exporter(profile)` and `now()` are for tests.
 */
function makeExportedCredentials({ profile, exporter = awsExport, now = Date.now, refreshBeforeMs = REFRESH_WITHIN_MS, recheckMs = RECHECK_MS, log = () => {} }) {
  let creds = null;
  let lastAsk = -Infinity;
  let inFlight = null;
  const seen = new Set();

  async function ask() {
    lastAsk = now();
    const fresh = parseExport(await exporter(profile), profile);
    for (const s of secretValues(fresh)) seen.add(s);
    return fresh;
  }

  async function refresh() {
    if (!creds) {
      creds = await ask();
      log(`aws credentials for profile ${profile} read${creds.expiresAt ? `, expire in ${minutes(creds.expiresAt - now())}` : ', no expiry'}`);
      return;
    }
    let fresh = null;
    try { fresh = await ask(); } catch (e) { log(`aws credential refresh failed: ${e.message}; keeping the current ones`); }
    if (fresh && (fresh.expiresAt === null || fresh.expiresAt > creds.expiresAt)) {
      creds = fresh;
      log(`aws credentials for profile ${profile} refreshed${fresh.expiresAt ? `, expire in ${minutes(fresh.expiresAt - now())}` : ', no expiry'}`);
    } else if (fresh) {
      log(`aws credential refresh gave the same expiry (${minutes(creds.expiresAt - now())} left); asking again in ${minutes(recheckMs)}`);
    }
  }

  async function current() {
    const stale = () => creds && creds.expiresAt !== null && creds.expiresAt - now() <= refreshBeforeMs;
    if (!creds || (stale() && (now() - lastAsk >= recheckMs || creds.expiresAt <= now()))) {
      inFlight ??= refresh().finally(() => { inFlight = null; });
      await inFlight;
    }
    if (creds.expiresAt !== null && creds.expiresAt <= now()) {
      throw new Error(`the aws credentials for profile ${profile} have expired and aws configure export-credentials gave no newer ones`);
    }
    return creds;
  }

  return { current, secrets: () => [...seen] };
}

/** The shared-credentials text for one profile. */
function credentialsText(profile, c) {
  return `[${profile}]\naws_access_key_id = ${c.accessKeyId}\naws_secret_access_key = ${c.secretAccessKey}\n${c.sessionToken ? `aws_session_token = ${c.sessionToken}\n` : ''}`;
}

/** Writes <home>/.aws/credentials (0600) and a config that names the region, as the file-based path does. */
function writeCredentials({ home, profile, region, creds }) {
  const dir = path.join(home, '.aws');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'credentials'), credentialsText(profile, creds), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'config'), `[profile ${profile}]\nregion = ${region}\n`, { mode: 0o600 });
}

module.exports = {
  REFRESH_WITHIN_MS, RECHECK_MS, EXPORT_TIMEOUT_MS, isProfileName,
  exportCredentials, awsExport, parseExport, parseProcessCredentials, envVars,
  profileCredentials, makeExportedCredentials, credentialsText, writeCredentials,
};
