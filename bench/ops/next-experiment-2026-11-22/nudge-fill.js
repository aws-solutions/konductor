#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fill stages: the cells a study's cap left budget skipped, run again under their own cap. Read only: it writes nothing.
//   nudge       run-nudge.sh --fill: the 3 cells the 450-credit nudge study left (cap 60, approved 2026-11-23)
//   model-swap  run-model-swap.sh --fill: the 2 Opus natural cells the 400-credit stage left (approved 2026-11-24)
//
//   node nudge-fill.js missing OUT TASK [SET]  the set's cells of TASK still to run ("arm rep" per line): no result.json,
//                                              or a budget_skipped one. Exit 1 when TASK has no folder, or a cell outside
//                                              the set is missing (it would be a run nobody counted).
//   node nudge-fill.js spent OUT LIMIT [SET]   counted credits of the set: each ledger call of a set cell, throttled
//                                              attempts included, at the larger of 15 and its credits (LIMIT when unknown).
//   node nudge-fill.js cells SET               the set's cells, "task arm rep" per line.
//
// OUT is the study folder (runs-nudge, runs-model-swap/natural). SET defaults to nudge. Only set cells are counted:
// every other cell ran under the study's own cap.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SETS = {
  nudge: {
    cells: [
      ['t1-nfr-report-queries', 'konductor-list', 3],
      ['t1-nfr-report-queries', 'konductor-filler', 3],
      ['t2-dr-notify-fanout', 'konductor-list', 3],
    ],
    arms: ['konductor-list', 'konductor-filler'],
    reps: [1, 2, 3],
  },
  'model-swap': {
    cells: [
      ['t1-nfr-report-queries', 'konductor', 2],
      ['t1-nfr-report-queries', 'konductor', 3],
    ],
    arms: ['konductor'],
    reps: [1, 2, 3],
  },
};
const MIN_CALL = 15;

function setOf(name = 'nudge') {
  const set = SETS[name];
  if (!set) throw new Error(`unknown set ${name} (${Object.keys(SETS).join(', ')})`);
  return set;
}

const inSet = (set, task, arm, rep) => set.cells.some(([t, a, r]) => t === task && a === arm && r === Number(rep));

/** The set's cells of `task` still to run, as [arm, rep]. Throws when a cell outside the set is missing. */
function missing(out, task, name) {
  const set = setOf(name);
  if (!fs.existsSync(path.join(out, task))) throw new Error(`${out}/${task} is missing: the fill stage only resumes a task folder`);
  const todo = [];
  for (const arm of set.arms) for (const rep of set.reps) {
    const file = path.join(out, task, arm, task, String(rep), 'result.json');
    const status = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).status : null;
    if (status !== null && status !== 'budget_skipped') continue;
    if (!inSet(set, task, arm, rep)) throw new Error(`${task} ${arm} #${rep} has no result but is not a fill-stage cell`);
    todo.push([arm, rep]);
  }
  return todo;
}

/** Counted credits of the set's cells in their tasks' ledgers: each call at max(15, credits), LIMIT when unknown. */
function spent(out, limit, name) {
  const set = setOf(name);
  let total = 0;
  for (const task of new Set(set.cells.map(([t]) => t))) {
    const file = path.join(out, task, 'credit-ledger.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; } // blank or partial last line
      if (e.kind !== 'run' || e.task !== task || !inSet(set, task, e.arm, e.replicate)) continue;
      total += Math.max(MIN_CALL, Number.isFinite(e.credits) ? e.credits : limit);
    }
  }
  return total;
}

if (require.main === module) {
  const [cmd, a1, a2, a3] = process.argv.slice(2);
  try {
    if (cmd === 'missing') for (const [arm, rep] of missing(a1, a2, a3)) console.log(`${arm} ${rep}`);
    else if (cmd === 'spent') console.log(spent(a1, Number(a2), a3).toFixed(2));
    else if (cmd === 'cells') for (const c of setOf(a1).cells) console.log(c.join(' '));
    else { console.error('usage: see the top of nudge-fill.js'); process.exitCode = 64; }
  } catch (e) { console.error(`nudge-fill ${cmd}: ${e.message}`); process.exitCode = 1; }
}

module.exports = { SETS, missing, spent };
