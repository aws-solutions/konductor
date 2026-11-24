#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Helpers of run-model-swap-judge.sh. Free: no model call.
//
//   node model-swap-judge.js ran SRC                  cells under SRC that ran (a result.json that is not budget_skipped)
//   node model-swap-judge.js prep SRC DEST ARM [KEEP]  copy one task folder to DEST with arm konductor renamed to ARM;
//                                                     KEEP (reps, comma separated) keeps only those cells
//   node model-swap-judge.js estimate LITE_RUNS TASK N  USD a run and the estimate for N runs of TASK
//
// prep: the bench names an arm by its folder, so the Opus copy gets its own arm id and can sit in one report beside
// the reused Sonnet konductor and vanilla arms. result.json armId and run-config.json follow the folder. Cells that
// never ran (budget_skipped) are left out of the copy, so the judge never sees them; with KEEP so are the cells whose
// replicate is not in it (the fill judge pass copies only the fill cells, so the first pass's judged cells are not
// judged or counted twice).
// estimate: the LITE first judge pass's USD per judged konductor run of the same task (the sum of its records' call
// USD over its runs), times MARGIN for Opus answers that may be longer; FALLBACK when that pass has no record of it.

const fs = require('node:fs');
const path = require('node:path');

const FROM = 'konductor';
const MARGIN = 2;
const FALLBACK = 0.05;

/** Result files of a run folder laid out <dir>/<arm>/<task>/<rep>/result.json. */
function results(dir) {
  const out = [];
  const subdirs = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
  for (const arm of subdirs(dir)) for (const task of subdirs(path.join(dir, arm))) for (const rep of subdirs(path.join(dir, arm, task))) {
    const file = path.join(dir, arm, task, rep, 'result.json');
    if (fs.existsSync(file)) out.push(file);
  }
  return out;
}

const neverRan = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).status === 'budget_skipped';

function ran(dir) {
  return results(dir).filter((f) => !neverRan(f)).length;
}

/**
 * Copies SRC to DEST, renames arm FROM to ARM everywhere the bench reads it, and drops cells that never ran.
 * `keep`, when given, is the list of replicates to keep; every other cell is dropped too.
 */
function prep(src, dest, arm, keep = null) {
  if (fs.existsSync(dest)) throw new Error(`${dest} exists`);
  fs.cpSync(src, dest, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  const from = path.join(dest, FROM);
  if (!fs.existsSync(from)) throw new Error(`${src} has no ${FROM} arm`);
  fs.renameSync(from, path.join(dest, arm));
  for (const file of results(dest)) {
    const rep = Number(path.basename(path.dirname(file)));
    if (neverRan(file) || (keep && !keep.includes(rep))) { fs.rmSync(path.dirname(file), { recursive: true }); continue; }
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r.armId === FROM) fs.writeFileSync(file, JSON.stringify({ ...r, armId: arm }));
  }
  const cfgFile = path.join(dest, 'run-config.json');
  if (fs.existsSync(cfgFile)) {
    const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (c.armIds) c.armIds = c.armIds.map((a) => (a === FROM ? arm : a));
    if (c.arms) c.arms = c.arms.map((a) => (a.id === FROM ? { ...a, id: arm } : a));
    fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2) + '\n');
  }
  return ran(dest);
}

/** USD per judged konductor run of TASK in the LITE judge dirs, or null when none was judged. */
function usdPerRun(liteRuns, task) {
  let usd = 0;
  const runs = new Set();
  for (const d of fs.existsSync(liteRuns) ? fs.readdirSync(liteRuns) : []) {
    const f = path.join(liteRuns, d, 'judgments.json');
    if (!fs.existsSync(f)) continue;
    for (const r of JSON.parse(fs.readFileSync(f, 'utf8')).rubric ?? []) {
      if (r.taskId !== task || r.armId !== FROM) continue;
      for (const c of r.calls ?? []) usd += c.usd ?? 0;
      runs.add(`${d}/${r.replicate}`);
    }
  }
  return runs.size ? usd / runs.size : null;
}

function estimate(liteRuns, task, n) {
  const per = usdPerRun(liteRuns, task);
  const used = per ?? FALLBACK;
  return { perRun: used, fromLite: per !== null, estimate: n * used * MARGIN };
}

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'ran') console.log(ran(a[0]));
    else if (cmd === 'prep') console.log(prep(a[0], a[1], a[2], a[3] ? a[3].split(',').map(Number) : null));
    else if (cmd === 'estimate') {
      const e = estimate(a[0], a[1], Number(a[2]));
      console.log(`${e.perRun.toFixed(4)} ${e.estimate.toFixed(4)} ${e.fromLite ? 'lite' : 'fallback'}`);
    } else { console.error('usage: see the top of model-swap-judge.js'); process.exitCode = 64; }
  } catch (e) { console.error(`model-swap-judge ${cmd}: ${e.message}`); process.exitCode = 1; }
}

module.exports = { ran, prep, estimate, MARGIN };
