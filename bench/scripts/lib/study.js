// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads over a study's run tree for the bash chains: which result files a task dir holds, whether a task dir is
// complete, the autonomy counts, and which tasks of a wave were budget-skipped. Read only.

const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrNull } = require('../../runner/lib/util.js');

const dirsIn = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
};
const namesIn = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

/**
 * Every <arm>/<task>/<rep>/result.json under dir.
 * @param {string} dir a task dir or wave output dir
 * @param {{skipHidden?: boolean}} [o] skipHidden leaves out arm dirs whose name starts with a dot
 * @returns {string[]} result file paths
 */
function resultFiles(dir, { skipHidden = false } = {}) {
  const out = [];
  for (const arm of dirsIn(dir)) {
    if (skipHidden && arm.startsWith('.')) continue;
    for (const task of dirsIn(path.join(dir, arm))) {
      for (const rep of namesIn(path.join(dir, arm, task))) {
        const f = path.join(dir, arm, task, rep, 'result.json');
        if (fs.existsSync(f)) out.push(f);
      }
    }
  }
  return out;
}

/**
 * Why a single-task dir is not complete, or 'complete'. Reads <dir>/summary.json only.
 * @param {string} dir task dir
 * @param {number} nArms arms the dir must hold
 * @param {number} reps replicates per arm
 * @returns {string} 'complete' or a short reason such as 'runs:3/20'
 */
function completeState(dir, nArms, reps) {
  const s = readJsonOrNull(path.join(dir, 'summary.json'));
  if (!s) return 'no-summary';
  if (s.interrupted) return `interrupted:${s.interrupted}`;
  if (!s.isolationGate || s.isolationGate.ok !== true) return 'isolation-gate-not-ok';
  if ((s.armIds || []).length !== Number(nArms) || s.replicates !== Number(reps) || (s.taskIds || []).length !== 1) return 'config-mismatch';
  const exp = s.armIds.length * s.replicates;
  if (!Array.isArray(s.results) || s.results.length !== exp) return `runs:${(s.results || []).length}/${exp}`;
  if (s.results.some((r) => r.status === 'budget_skipped')) return 'budget-skipped';
  return 'complete';
}

/**
 * Autonomy runs, how many asked the user, and how many reached a second turn.
 * @param {string[]} dirs task dirs
 * @returns {string} 'runs=N askedUser=A secondTurn=S'
 */
function autonomyStats(dirs) {
  let runs = 0, asked = 0, second = 0;
  for (const d of dirs) {
    for (const f of resultFiles(d)) {
      const r = readJsonOrNull(f);
      if (!r || !String(r.taskId || '').startsWith('autonomy')) continue;
      runs++;
      if (r.askedUser === true) asked++;
      if ((r.turns || 0) >= 2) second++;
    }
  }
  return `runs=${runs} askedUser=${asked} secondTurn=${second}`;
}

/**
 * Task ids with a budget_skipped run in a wave output dir (arm dirs starting with a dot are left out).
 * @param {string} root wave output dir
 * @returns {string[]} sorted task ids
 */
function budgetSkippedTasks(root) {
  const ids = new Set();
  for (const f of resultFiles(root, { skipHidden: true })) {
    if (readJsonOrNull(f)?.status === 'budget_skipped') ids.add(path.basename(path.dirname(path.dirname(f))));
  }
  return [...ids].sort();
}

module.exports = { resultFiles, completeState, autonomyStats, budgetSkippedTasks };
