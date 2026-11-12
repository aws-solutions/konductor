// SPDX-License-Identifier: Apache-2.0
'use strict';

// Is the kiro-cli login still valid? Runs `kiro-cli whoami` the way a run does: scratch HOME with a copy of the auth
// database, the allowlisted environment, the same binary. Only a definite failure stops a chunk; a CLI without the
// subcommand, a timeout or a spawn problem is reported as unavailable and the chunk goes on.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const sandbox = require('./sandbox.js');
const { buildChildEnv } = require('./env.js');
const { authFailureText } = require('./auth-failure.js');

const WHOAMI_TIMEOUT_MS = 30000;
const DEFAULT_CHECK_EVERY_MS = 5 * 60 * 1000;
const NO_SUBCOMMAND = /unrecognized subcommand|unknown (?:sub)?command|no such (?:sub)?command|invalid subcommand/i;

function whoami(bin, env, timeout) {
  return new Promise((resolve) => {
    execFile(bin, ['whoami'], { env, timeout, encoding: 'utf8', maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      resolve({ error, output: `${stdout || ''}\n${stderr || ''}` });
    });
  });
}

/** { ok: true } | { ok: true, unavailable: reason } | { ok: false, detail }. Never throws. */
async function checkKiroLogin({ kiroBin, authDb, scratchDir, envKeep = [], agentEngine, timeoutMs = WHOAMI_TIMEOUT_MS, run = whoami }) {
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(scratchDir, 'who-'));
    sandbox.copyAuthDb(authDb, dir);
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    const { env } = buildChildEnv(process.env, { home: dir, tmpdir: path.join(dir, 'tmp'), agentEngine, keep: envKeep });
    const { error, output } = await run(kiroBin, env, timeoutMs);
    const authText = authFailureText(output);
    if (!error) return authText ? { ok: false, detail: authText } : { ok: true };
    if (NO_SUBCOMMAND.test(output)) return { ok: true, unavailable: 'this kiro-cli has no whoami command' };
    if (typeof error.code !== 'number') return { ok: true, unavailable: `whoami did not finish (${error.code || error.signal || error.message})` };
    return { ok: false, detail: authText || output.split('\n').map((l) => l.trim()).find(Boolean) || `kiro-cli whoami exited ${error.code}` };
  } catch (e) {
    return { ok: true, unavailable: `login check could not run: ${e.message}` };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The check the driver uses, or null when the engine is not kiro-cli. `check` is replaceable so tests never run the real CLI. */
function makeLoginCheck({ isUsd, kiroBin, authDb, scratchDir, envKeep, agentEngine, check = checkKiroLogin }) {
  if (isUsd) return null;
  return () => check({ kiroBin, authDb, scratchDir, envKeep, agentEngine });
}

module.exports = { checkKiroLogin, makeLoginCheck, DEFAULT_CHECK_EVERY_MS, WHOAMI_TIMEOUT_MS };
