// SPDX-License-Identifier: Apache-2.0
'use strict';

// AWS credentials for the opencode judge backend, kept fresh for a pass that outlives one session. `judge
// --aws-export-profile NAME` asks `aws configure export-credentials --profile NAME` for them and asks again when fewer than
// `refreshBeforeMs` remain. A credential process can hand back the same cached expiry until shortly before it runs out, so a
// refresh that brings no later expiry keeps the current values and asks again `recheckMs` later rather than stopping the
// pass; only credentials that have run out with nothing newer stop it. Values are held in memory, written only into each
// judge call's scratch HOME, and never logged or put in an error message.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const REFRESH_BEFORE_MS = 15 * 60 * 1000;
const RECHECK_MS = 60 * 1000;
// Variables that would make the aws CLI ignore the named profile.
const OVERRIDES = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_DEFAULT_PROFILE'];

/** Runs `aws configure export-credentials` and resolves its stdout; the error names the exit, never the output. */
function awsExport(profile, { bin = 'aws', env = process.env, timeoutMs = 60000 } = {}) {
  const childEnv = { ...env };
  for (const k of OVERRIDES) delete childEnv[k];
  return new Promise((resolve, reject) => {
    execFile(bin, ['configure', 'export-credentials', '--profile', profile, '--format', 'process'], { env: childEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(`aws configure export-credentials --profile ${profile} failed (${err.killed ? 'timed out' : `exit ${err.code ?? 'unknown'}`})`));
      else resolve(stdout);
    });
  });
}

/** { accessKeyId, secretAccessKey, sessionToken, expiresAt } from the credential-process JSON; throws on any other shape. */
function parseExport(stdout) {
  let v;
  try { v = JSON.parse(stdout); } catch { throw new Error('aws configure export-credentials printed something that is not JSON'); }
  if (!v || typeof v.AccessKeyId !== 'string' || !v.AccessKeyId || typeof v.SecretAccessKey !== 'string' || !v.SecretAccessKey) {
    throw new Error('aws configure export-credentials gave no access key pair');
  }
  const expiresAt = v.Expiration ? Date.parse(v.Expiration) : null;
  if (v.Expiration && !Number.isFinite(expiresAt)) throw new Error('aws configure export-credentials gave an expiry that is not a date');
  return { accessKeyId: v.AccessKeyId, secretAccessKey: v.SecretAccessKey, sessionToken: typeof v.SessionToken === 'string' && v.SessionToken ? v.SessionToken : null, expiresAt };
}

const minutes = (ms) => `${Math.round(ms / 60000)} min`;

/**
 * A provider of fresh credentials: `await current()` resolves { accessKeyId, secretAccessKey, sessionToken, expiresAt }.
 * `secrets()` lists every secret value seen so far, for scrubbing. `exporter(profile)` and `now()` are for tests.
 */
function makeExportedCredentials({ profile, exporter = awsExport, now = Date.now, refreshBeforeMs = REFRESH_BEFORE_MS, recheckMs = RECHECK_MS, log = () => {} }) {
  let creds = null;
  let lastAsk = -Infinity;
  let inFlight = null;
  const seen = new Set();
  const keep = (c) => { for (const s of [c.secretAccessKey, c.sessionToken, c.accessKeyId]) if (s) seen.add(s); };

  async function ask() {
    lastAsk = now();
    const fresh = parseExport(await exporter(profile));
    keep(fresh);
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

module.exports = { REFRESH_BEFORE_MS, RECHECK_MS, awsExport, parseExport, makeExportedCredentials, credentialsText, writeCredentials };
