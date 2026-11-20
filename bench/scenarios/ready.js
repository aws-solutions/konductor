// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios ready [DIR] [--batch tN] [--ids] [--late] [--json]`: which pack tasks may enter a paid pilot wave.
// A task is ready only when its batch folder loads in the runner (one bad file stops a whole `--extra-tasks` folder)
// and its `pilot.dryRun` records reference >= 95, stub <= 20, lazy <= 40 and alternative >= 80 (plan 4.6).
// Not-ready tasks go to wave W9 late. Free: reads the task files only.

const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../runner/lib/schema.js');
const { v3Errors } = require('../runner/lib/task-v3.js');

const PACK_DIR = __dirname;
const GATES = [
  ['reference', (v) => v >= 95, '>= 95'],
  ['stub', (v) => v <= 20, '<= 20'],
  ['lazy', (v) => v <= 40, '<= 40'],
  ['alt', (v) => v >= 80, '>= 80'],
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The reasons a task is not ready, from its own file; [] when the dry run passes every gate. */
function dryRunReasons(task) {
  const d = task.pilot?.dryRun;
  if (!d) return ['no pilot.dryRun recorded'];
  const out = [];
  for (const [k, ok, rule] of GATES) {
    if (!finite(d[k])) out.push(`dry run has no ${k} score`);
    else if (!ok(d[k])) out.push(`dry run ${k} ${d[k]}, needs ${rule}`);
  }
  return out;
}

/** [{ batch, id, file, ready, reasons }] for every task of every t* folder under `packDir`. */
function readiness(packDir = PACK_DIR) {
  const schema = loadSchema('task');
  const out = [];
  for (const batch of fs.readdirSync(packDir).filter((d) => /^t\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const dir = path.join(packDir, batch);
    const rows = [];
    const badFiles = [];
    for (const f of fs.readdirSync(dir).filter((x) => /^t\d+-.*\.json$/.test(x)).sort()) {
      const task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const loadErrors = [...validate(schema, task), ...v3Errors(task)];
      if (loadErrors.length) badFiles.push(f);
      const reasons = loadErrors.length ? [`fails the run loader (${loadErrors.length} error(s), first: ${loadErrors[0]})`] : [];
      rows.push({ batch, id: task.id, file: path.join(batch, f), reasons: [...reasons, ...dryRunReasons(task)] });
    }
    for (const r of rows) {
      if (badFiles.length && !badFiles.includes(path.basename(r.file))) r.reasons.unshift(`batch folder fails the run loader (${badFiles.length} file(s), first ${badFiles[0]})`);
      out.push({ ...r, ready: r.reasons.length === 0 });
    }
  }
  return out;
}

function render(rows) {
  const L = [];
  const batches = [...new Set(rows.map((r) => r.batch))];
  L.push('| batch | tasks | ready | not ready (W9 late) |', '| --- | --- | --- | --- |');
  for (const b of batches) {
    const in_ = rows.filter((r) => r.batch === b);
    L.push(`| ${b} | ${in_.length} | ${in_.filter((r) => r.ready).length} | ${in_.filter((r) => !r.ready).length} |`);
  }
  L.push('', 'Ready:', ...rows.filter((r) => r.ready).map((r) => `- ${r.id}`));
  if (!rows.some((r) => r.ready)) L.push('- none');
  L.push('', 'Not ready (W9 late):', ...rows.filter((r) => !r.ready).map((r) => `- ${r.id}: ${r.reasons.join('; ')}`));
  return `${L.join('\n')}\n`;
}

function cmdReady(opts) {
  const dir = opts._[1] ? path.resolve(opts._[1]) : PACK_DIR;
  let rows = readiness(dir);
  if (typeof opts.batch === 'string') {
    rows = rows.filter((r) => r.batch === opts.batch);
    if (!rows.length) throw new Error(`no batch ${opts.batch} under ${dir}`);
  }
  if (opts.ids) {
    // Comma list for `run --tasks`: the ready tasks, or with --late the not-ready ones. Empty output when there are none.
    process.stdout.write(`${rows.filter((r) => (opts.late ? !r.ready : r.ready)).map((r) => r.id).join(',')}\n`);
    return;
  }
  process.stdout.write(opts.json ? `${JSON.stringify(rows, null, 2)}\n` : render(rows));
}

module.exports = { readiness, dryRunReasons, render, cmdReady, GATES };
