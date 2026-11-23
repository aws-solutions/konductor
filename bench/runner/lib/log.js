// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner's log (FW-29): the console line `bench run` has always printed, and the same line as JSON in
// <out>/runner.log, with structured events (start, cell, end) beside them. Lines logged before the output directory is
// known are kept and written when `attach` names it. Node built-ins only.

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOG_FILE = 'runner.log';

/**
 * A log function: `log(text)` prints `[bench HH:MM:SS] text` through `write` and records `{t, level: 'info', event:
 * 'message', msg}`; `log.event(level, event, fields)` records a structured line only; `log.attach(dir)` starts writing
 * <dir>/runner.log (appending, so a resumed run keeps its earlier lines). `write` and `now` are for tests.
 */
function makeRunnerLog({ write = (s) => process.stderr.write(`${s}\n`), now = () => new Date() } = {}) {
  let file = null;
  const pending = [];
  const record = (entry) => {
    const line = `${JSON.stringify(entry)}\n`;
    if (!file) { pending.push(line); return; }
    try { fs.appendFileSync(file, line); } catch { /* the log is a copy of what the console shows; never fail the run on it */ }
  };
  const log = (msg) => {
    const t = now();
    write(`[bench ${t.toISOString().slice(11, 19)}] ${msg}`);
    record({ t: t.toISOString(), level: 'info', event: 'message', msg: String(msg) });
  };
  log.event = (level, event, fields = {}) => {
    if (!LEVELS.has(level)) throw new Error(`log level "${level}" is not one of ${[...LEVELS].join(', ')}`);
    record({ t: now().toISOString(), level, event, ...fields });
  };
  log.attach = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, LOG_FILE);
    fs.appendFileSync(file, pending.splice(0).join(''));
  };
  return log;
}

module.exports = { makeRunnerLog, LOG_FILE };
