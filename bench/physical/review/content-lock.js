#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// One content per plant variant id (D-183). A plant task's id carries its version (`<probe>.vNN`), so a change to its
// prompt, environment or fixture must come as a new id. The lock file holds, per id, the hash the scenario pack's
// content lock computes (bench/scenarios/content-lock.js contentHash: the task file and its fixture dir).
//
//   node bench/physical/review/content-lock.js --tasks DIR --lock FILE           check; exit 1 and name each id that differs
//   node bench/physical/review/content-lock.js --tasks DIR --lock FILE --write   record new ids; refuses a same-id change

const fs = require('node:fs');
const path = require('node:path');
const { contentHash } = require('../../scenarios/content-lock.js');

/** Per task file in `dir`: `{id, sha256, problem}`, problem null, 'new' or 'same-id change', against `lock` (`{id: {sha256}}`). */
function compareTasks(dir, lock) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = path.join(dir, f);
    const task = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sha256 = contentHash(file, task);
    const entry = lock[task.id];
    return { id: task.id, sha256, problem: !entry ? 'new' : entry.sha256 !== sha256 ? 'same-id change' : null };
  });
}

const SAME_ID = (id) => `${id}: content changed under the same id; write it as a new version (a new vNN) and keep the old one`;

/** CLI entry; returns the exit code. `io` holds `log` and `error` (tests). */
function main(argv, io = { log: console.log, error: console.error }) {
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  const [dir, lockFile] = [flag('tasks'), flag('lock')];
  if (!dir || !lockFile || !fs.existsSync(dir)) {
    io.error('usage: content-lock.js --tasks DIR --lock FILE [--write]');
    return 2;
  }
  const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')).tasks ?? {} : {};
  const rows = compareTasks(dir, lock);
  const changed = rows.filter((r) => r.problem === 'same-id change');
  if (!argv.includes('--write')) {
    for (const r of rows.filter((x) => x.problem)) io.log(r.problem === 'new' ? `${r.id}: new (run with --write to record it)` : SAME_ID(r.id));
    io.log(rows.some((r) => r.problem) ? `${rows.filter((r) => r.problem).length} task(s) differ from ${lockFile}` : `ok: ${rows.length} task(s) match ${lockFile}`);
    return rows.some((r) => r.problem) ? 1 : 0;
  }
  if (changed.length) { for (const r of changed) io.error(SAME_ID(r.id)); return 1; }
  const tasks = { ...lock, ...Object.fromEntries(rows.map((r) => [r.id, { sha256: r.sha256 }])) };
  const sorted = Object.fromEntries(Object.keys(tasks).sort().map((k) => [k, tasks[k]]));
  fs.writeFileSync(lockFile, `${JSON.stringify({ _comment: 'Written by bench/physical/review/content-lock.js; one content per variant id.', tasks: sorted }, null, 2)}\n`);
  io.log(`wrote ${Object.keys(sorted).length} id(s) to ${lockFile}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { compareTasks, main };
