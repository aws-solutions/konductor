// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tool-less model call behind `cap draft` and the trigger proxy. It is the judge call: a headless kiro-cli in a
// scratch HOME with no agents or skills, an empty working directory, no tools trusted, and the credential copy removed
// after the call. `--model-cmd CMD` swaps in a command that reads the prompt on stdin (for tests and offline use).

const fs = require('node:fs');
const path = require('node:path');
const { makeKiroCaller, makeCmdCaller } = require('../judge/model.js');
const { resolveIsolation } = require('../runner/lib/isolate.js');
const sandbox = require('../runner/lib/sandbox.js');
const procs = require('../runner/lib/procs.js');

const DEFAULT_MODEL = 'claude-sonnet-5.5';
const TIMEOUT_MS = 300000;

const list = (v) => (v === undefined || v === true || v === '' ? [] : String(v).split(',').filter(Boolean));

/** { caller, cleanup }. `rawDir` keeps each call's raw stream for audit (kiro only). */
function makeCapCaller(opts, { rawDir = null, log = () => {} } = {}) {
  const cmd = opts['model-cmd'] || process.env.BENCH_JUDGE_CMD;
  if (cmd) return { caller: makeCmdCaller(String(cmd), { timeoutMs: TIMEOUT_MS }), cleanup: () => {} };
  const authDb = opts['auth-db'] ? path.resolve(opts['auth-db']) : sandbox.defaultAuthDb();
  if (!fs.existsSync(authDb)) throw new Error(`kiro-cli auth database not found: ${authDb} (log in with kiro-cli first)`);
  const isolation = resolveIsolation(opts.isolate || 'auto');
  log(`isolation: ${isolation.mode} (${isolation.reason})`);
  const hide = [...list(opts.hide), ...list(process.env.BENCH_HIDE_EXTRA)];
  const removeHandlers = procs.installSignalHandlers({ flush: () => {}, log });
  const caller = makeKiroCaller({
    authDb, timeoutMs: TIMEOUT_MS, isolation: { mode: isolation.mode, hide }, rawDir,
    ...(opts['kiro-bin'] && opts['kiro-bin'] !== true ? { kiroBin: path.resolve(opts['kiro-bin']) } : {}),
  });
  return { caller, cleanup: () => { removeHandlers(); procs.removeAllScratch(); } };
}

module.exports = { makeCapCaller, DEFAULT_MODEL };
