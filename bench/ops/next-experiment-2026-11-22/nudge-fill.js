#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The fill stage of run-nudge.sh (--fill): the cells the 450-credit study left budget skipped on its two tasks with no
// .done, run under their own 60-credit cap (approved 2026-11-23). Read only: it writes nothing.
//
//   node nudge-fill.js missing OUT TASK   the stage cells of TASK still to run ("arm rep" per line): no result.json, or
//                                         a budget_skipped one. Exit 1 when TASK has no folder, or a cell outside the
//                                         stage is missing (it would be a run nobody counted).
//   node nudge-fill.js spent OUT LIMIT    counted credits of the stage: each ledger call of a stage cell, throttled
//                                         attempts included, at the larger of 15 and its credits (LIMIT when unknown).
//
// OUT is the study folder (runs-nudge). Only stage cells are counted: every other cell ran under the 450 cap.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CELLS = [
  ['t1-nfr-report-queries', 'konductor-list', 3],
  ['t1-nfr-report-queries', 'konductor-filler', 3],
  ['t2-dr-notify-fanout', 'konductor-list', 3],
];
const ARMS = ['konductor-list', 'konductor-filler'];
const REPS = [1, 2, 3];
const MIN_CALL = 15;

const inStage = (task, arm, rep) => CELLS.some(([t, a, r]) => t === task && a === arm && r === Number(rep));

/** The stage cells of `task` still to run, as [arm, rep]. Throws when a cell outside the stage is missing. */
function missing(out, task) {
  if (!fs.existsSync(path.join(out, task))) throw new Error(`${out}/${task} is missing: the fill stage only resumes a task folder`);
  const todo = [];
  for (const arm of ARMS) for (const rep of REPS) {
    const file = path.join(out, task, arm, task, String(rep), 'result.json');
    const status = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).status : null;
    if (status !== null && status !== 'budget_skipped') continue;
    if (!inStage(task, arm, rep)) throw new Error(`${task} ${arm} #${rep} has no result but is not a fill-stage cell`);
    todo.push([arm, rep]);
  }
  return todo;
}

/** Counted credits of the stage cells in their tasks' ledgers: each call at max(15, credits), LIMIT when unknown. */
function spent(out, limit) {
  let total = 0;
  for (const task of new Set(CELLS.map(([t]) => t))) {
    const file = path.join(out, task, 'credit-ledger.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; } // blank or partial last line
      if (e.kind !== 'run' || e.task !== task || !inStage(task, e.arm, e.replicate)) continue;
      total += Math.max(MIN_CALL, Number.isFinite(e.credits) ? e.credits : limit);
    }
  }
  return total;
}

const [cmd, out, arg] = process.argv.slice(2);
try {
  if (cmd === 'missing') for (const [arm, rep] of missing(out, arg)) console.log(`${arm} ${rep}`);
  else if (cmd === 'spent') console.log(spent(out, Number(arg)).toFixed(2));
  else { console.error('usage: see the top of nudge-fill.js'); process.exitCode = 64; }
} catch (e) { console.error(`nudge-fill ${cmd}: ${e.message}`); process.exitCode = 1; }
