#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// rescore-by-limit.js: read-only. Re-scores a run dir with a time limit T applied after the fact: any run whose wall time is over T
// counts as a timeout. Uses bench's own row builder and quality formula (same scoring, same quality pack as `report`), so
// at the largest T (nothing over it) the numbers equal the report's. It writes one markdown file and changes nothing else.
//
//   node rescore-by-limit.js --run DIR --baseline vanilla --variant konductor [--limits 600,1200,1800] [--extra-tasks DIRS] [--scoring FILE] --out FILE
//
// For each limit T and each treatment of the runs over T:
//   asis      the run keeps the score it got (it was scored on what it produced)           [what the kit does]
//   drop      the run is removed from its arm                                              [the pre-declared "without timeouts"]
//   zero      the run counts as a failure with quality 0
// Result per treatment: konductor minus vanilla, mean over tasks of the per-task mean quality, and a 95% interval
// (Student t over the tasks). This interval is simpler than the one `report` prints; use `report` for the verdict.
const fs = require('node:fs');
const path = require('node:path');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
// The bench directory whose scoring code is used: the one this file sits in (bench/kit/2x2 -> bench), or BENCH_ROOT.
const BENCH = process.env.BENCH_ROOT || path.resolve(__dirname, '..', '..');
if (!fs.existsSync(`${BENCH}/report/load.js`)) { console.error(`rescore-by-limit: ${BENCH} is not a bench directory; set BENCH_ROOT to one (a copy of this file outside bench/ needs it)`); process.exit(2); }
const { loadRun } = require(`${BENCH}/report/load.js`);
const { analyze } = require(`${BENCH}/report/generate.js`);
const { loadTasks } = require(`${BENCH}/runner/lib/tasks.js`);
const { loadPack } = require(`${BENCH}/judge/pack/index.js`);
const { qualityOfRun } = require(`${BENCH}/report/scores.js`);

const runDir = path.resolve(arg('run'));
const base = arg('baseline', 'vanilla');
const variant = arg('variant', 'konductor');
const limits = arg('limits', '600,1200,1800').split(',').map(Number);
const extra = arg('extra-tasks') ? arg('extra-tasks').split(',').map((d) => fs.realpathSync(d)) : [];
const out = arg('out');

const T975 = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function interval(ds) {
  if (ds.length < 2) return null;
  const m = mean(ds);
  const sd = Math.sqrt(ds.reduce((a, d) => a + (d - m) ** 2, 0) / (ds.length - 1));
  const t = T975[Math.min(ds.length - 1, T975.length - 1)] ?? 1.96;
  return [m - t * sd / Math.sqrt(ds.length), m + t * sd / Math.sqrt(ds.length)];
}

const run = loadRun(runDir);
const tasks = loadTasks(BENCH, { extraDirs: extra });
const res = analyze({ run, tasks, baseline: base, scoringFile: arg('scoring'), qualityPack: loadPack('quality') });
const rows = res.rows.filter((r) => r.outcome !== 'infraError' && r.outcome !== 'modelMismatch');
const score = (r) => qualityOfRun(r, res.weights)?.score ?? null;

function perTask(treat, T) {
  const byTask = new Map();
  for (const r of rows) {
    const over = r.wall !== null && r.wall / 1000 > T;
    let q = score(r);
    if (over && treat === 'drop') continue;
    if (over && treat === 'zero') q = 0;
    if (q === null) continue;
    const k = `${r.task}|${r.arm}`;
    if (!byTask.has(k)) byTask.set(k, []);
    byTask.get(k).push(q);
  }
  return byTask;
}
function contrast(treat, T) {
  const m = perTask(treat, T);
  const taskIds = [...new Set(rows.map((r) => r.task))];
  const ds = [];
  for (const t of taskIds) {
    const a = m.get(`${t}|${variant}`), b = m.get(`${t}|${base}`);
    if (a && b) ds.push(mean(a) - mean(b));
  }
  const ci = interval(ds);
  const over = rows.filter((r) => r.wall !== null && r.wall / 1000 > T);
  return { n: ds.length, diff: ds.length ? mean(ds) : null, ci, over: over.length, overBy: Object.fromEntries([base, variant].map((a) => [a, over.filter((r) => r.arm === a).length])) };
}
const f = (x) => (x === null || x === undefined ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(1));
const L = [`# Re-score of ${runDir} at time limits ${limits.join(', ')} s`, '',
  `${variant} minus ${base}, quality 0 to 100 (same scoring and quality pack as the report). Mean of per-task means; interval is a 95% t-interval over the tasks (n = tasks with both arms).`, '',
  '| limit | runs over the limit (base / variant) | treatment | tasks | difference | 95% interval |', '| --- | --- | --- | --- | --- | --- |'];
for (const T of limits) for (const treat of ['asis', 'drop', 'zero']) {
  const c = contrast(treat, T);
  L.push(`| ${T} s | ${c.overBy[base]} / ${c.overBy[variant]} | ${treat} | ${c.n} | ${f(c.diff)} | ${c.ci ? `[${f(c.ci[0])}, ${f(c.ci[1])}]` : 'n/a'} |`);
}
L.push('', 'asis: the run keeps its score. drop: runs over the limit are removed. zero: runs over the limit score 0.', '');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, L.join('\n'));
console.log(L.join('\n'));
