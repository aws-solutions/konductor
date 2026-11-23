// SPDX-License-Identifier: Apache-2.0
'use strict';

// The chain's credentials check. Only the file's PATH is used: the contents are never read or printed.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { ts, fmtDur } = require('./context.js');
const { nap } = require('./proc.js');

/**
 * Whether the scoped credentials file works for a cheap Bedrock call. Sets ctx.credNote to why not (or to a note
 * when listing models is denied, which is not treated as expired).
 * @returns {boolean}
 */
function credsOk(ctx) {
  const c = ctx.cfg;
  ctx.credNote = '';
  if (!c.creds) { ctx.credNote = 'CREDS is not set'; return false; }
  let st;
  try { st = fs.statSync(c.creds); fs.accessSync(c.creds, fs.constants.R_OK); } catch { st = null; }
  if (!st || st.size === 0) { ctx.credNote = 'credentials file missing, empty or unreadable'; return false; }
  const env = { ...process.env, AWS_SHARED_CREDENTIALS_FILE: c.creds, AWS_CONFIG_FILE: '/dev/null', AWS_PROFILE: c.awsProfile };
  for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete env[k];
  const r = spawnSync(c.awsBin, ['bedrock', 'list-foundation-models', '--region', c.awsRegion, '--query', 'length(modelSummaries)', '--output', 'text'],
    { env, encoding: 'utf8', timeout: 90000, killSignal: 'SIGTERM', stdio: ['ignore', 'pipe', 'pipe'] });
  const rc = r.error && r.error.code === 'ENOENT' ? 127 : r.status ?? 124;
  if (rc === 0) return true;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (/AccessDenied|not authorized|UnauthorizedOperation/i.test(out)) {
    ctx.credNote = 'listing models is denied for the scoped session (not treated as expired)';
    return true;
  }
  ctx.credNote = (/An error occurred \([A-Za-z]+\)/.exec(out) || [])[0] || `aws call failed with exit status ${rc}`;
  return false;
}

/**
 * Wait for valid credentials, polling every credPollS for up to credTimeoutS.
 * @param {string} what what needs them, for the log line
 * @returns {Promise<number>} 0 valid, 1 timed out, 130 stopped
 */
async function waitForCredentials(ctx, what) {
  const c = ctx.cfg;
  if (credsOk(ctx)) return 0;
  const t0 = Date.now() / 1000;
  const waited = () => Math.floor(Date.now() / 1000 - t0);
  let n = 0;
  ctx.stSet('WAITING_FOR_CREDENTIALS', `${what} since ${ts()}`);
  ctx.say(`WAITING FOR CREDENTIALS: re-vend the credentials to ${c.creds}  (needed for ${what}; last check: ${ctx.credNote}; polling every ${c.credPollS}s for up to ${Math.floor(c.credTimeoutS / 3600)} h)`);
  for (;;) {
    await nap(ctx, c.credPollS);
    if (ctx.stopping) return 130;
    n++;
    if (credsOk(ctx)) {
      ctx.say(`credentials are valid again after ${fmtDur(waited())}`);
      ctx.stSet('WAITING_FOR_CREDENTIALS', 'none');
      return 0;
    }
    if (waited() >= c.credTimeoutS) {
      ctx.stSet('WAITING_FOR_CREDENTIALS', 'none');
      ctx.say(`gave up waiting for credentials after ${fmtDur(c.credTimeoutS)}`);
      return 1;
    }
    if (n % 6 === 0) ctx.say(`WAITING FOR CREDENTIALS: re-vend the credentials to ${c.creds}  (needed for ${what}; waited ${fmtDur(waited())}; last check: ${ctx.credNote})`);
  }
}

module.exports = { credsOk, waitForCredentials };
