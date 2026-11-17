// SPDX-License-Identifier: Apache-2.0
'use strict';

// AWS credentials read from a named profile with `aws configure export-credentials`, for runs that take exported keys
// (Claude Code). A study outlives a temporary session, so the keys are read again before a run when the cached ones
// are about to expire. Values go only into the environment of the run that asked; they are never logged or written.

const { execFileSync } = require('node:child_process');

const REFRESH_WITHIN_MS = 15 * 60 * 1000;
const PROFILE_RE = /^[A-Za-z0-9._@+-]{1,128}$/;
// Variables that would make `aws` read something other than the named profile.
const OVERRIDES = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_DEFAULT_PROFILE'];

/** Runs `aws configure export-credentials --profile <p> --format process` and returns its stdout. */
function exportCredentials(profile, { awsBin = 'aws', baseEnv = process.env } = {}) {
  const env = { ...baseEnv };
  for (const k of OVERRIDES) delete env[k];
  try {
    return execFileSync(awsBin, ['configure', 'export-credentials', '--profile', profile, '--format', 'process'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (e) {
    // stderr of the AWS CLI names the profile and the problem, never a key.
    const why = (e.stderr ? String(e.stderr) : e.message).trim().split('\n').filter(Boolean).at(-1) ?? 'no output';
    throw new Error(`aws configure export-credentials --profile ${profile} failed: ${why.slice(0, 300)}`);
  }
}

/** The three variables and the expiry (ms since epoch, or null) from the process-format JSON. Never echoes a value. */
function parseProcessCredentials(text, profile) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`aws configure export-credentials --profile ${profile} did not print JSON`); }
  if (!j || typeof j.AccessKeyId !== 'string' || typeof j.SecretAccessKey !== 'string' || !j.AccessKeyId || !j.SecretAccessKey) {
    throw new Error(`aws configure export-credentials --profile ${profile} printed no AccessKeyId and SecretAccessKey`);
  }
  const expiresAt = j.Expiration ? Date.parse(j.Expiration) : NaN;
  const vars = { AWS_ACCESS_KEY_ID: j.AccessKeyId, AWS_SECRET_ACCESS_KEY: j.SecretAccessKey };
  if (typeof j.SessionToken === 'string' && j.SessionToken) vars.AWS_SESSION_TOKEN = j.SessionToken;
  return { vars, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
}

/**
 * A credential source for `profile`. `current()` returns the variables for the next run, reading the profile again
 * when nothing is cached, when the cached keys carry no expiry, or when they expire within `refreshWithinMs`.
 * `values()` lists every secret value handed out so far, for scrubbing output files.
 */
function profileCredentials(profile, { read = (p) => exportCredentials(p), now = Date.now, refreshWithinMs = REFRESH_WITHIN_MS } = {}) {
  if (typeof profile !== 'string' || !PROFILE_RE.test(profile)) throw new Error('--aws-profile needs a profile name (letters, digits, . _ @ + -)');
  let cached = null;
  let refreshes = 0;
  const issued = new Set();
  const stale = () => !cached || cached.expiresAt === null || cached.expiresAt - now() < refreshWithinMs;
  return {
    profile,
    current() {
      if (stale()) {
        cached = parseProcessCredentials(read(profile), profile);
        refreshes++;
        for (const v of Object.values(cached.vars)) issued.add(v);
        if (cached.expiresAt !== null && cached.expiresAt - now() < refreshWithinMs) {
          const mins = Math.max(0, Math.round((cached.expiresAt - now()) / 60000));
          throw new Error(`the credentials of profile ${profile} expire in ${mins} minute(s), too soon for a run; refresh the profile's session and start again`);
        }
      }
      return { ...cached.vars };
    },
    expiresAt: () => cached?.expiresAt ?? null,
    refreshes: () => refreshes,
    values: () => [...issued],
  };
}

module.exports = { profileCredentials, exportCredentials, parseProcessCredentials, REFRESH_WITHIN_MS };
