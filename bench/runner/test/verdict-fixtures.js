// SPDX-License-Identifier: Apache-2.0
'use strict';

// Run directories for the platform verdict tests. Quality is steered through the hidden-test fraction of each run:
// with the default checks passing, one tenth of hidden tests is 7.14 quality points.

const path = require('node:path');
const { tmp, makeBench, makeRun, addTask, write } = require('./helpers.js');

const TASKS6 = ['t1', 't2', 't3', 't4', 't5', 't6'];
const SHA = { a: 'a'.repeat(40), b: 'b'.repeat(40), c: 'c'.repeat(40), d: 'd'.repeat(40), e: 'e'.repeat(40) };
const POINT = 100 / 14;

/**
 * arms: { id: { sha?, hidden: [passed per run, cycled] or hiddenByTask: { task: passed or [passed per replicate] }, credits?, wall?, status?, outcomeEvery?: { n, status } } }.
 * reps replicates per task, tasks task ids. Returns the run directory.
 */
function fixtureRun(root, name, { arms, reps = 5, tasks = ['t1', 't2'], armOrder = Object.keys(arms), config = {}, bench = null }) {
  const benchDir = bench ?? makeBench(path.join(root, `bench-${name}`));
  for (const t of tasks.filter((x) => x !== 't1')) addTask(benchDir, t, 'simple');
  const specs = [];
  for (const [arm, a] of Object.entries(arms)) {
    let k = 0;
    for (const task of tasks) {
      for (let rep = 1; rep <= reps; rep++) {
        const byTask = a.hiddenByTask?.[task];
        const hidden = a.hiddenByTask ? (Array.isArray(byTask) ? byTask[(rep - 1) % byTask.length] : byTask) : a.hidden[k % a.hidden.length];
        k++;
        const failed = a.fail && a.fail(k, task, rep);
        specs.push({
          arm, task, rep,
          hiddenTests: { passed: hidden, total: 10 }, credits: a.credits ?? 1, wallClockMs: a.wall ?? 1000,
          ...(a.extra ?? {}), ...(a.extraFn ? a.extraFn(task, rep) : {}),
          ...(a.sha ? { commitSha: SHA[a.sha] ?? a.sha, contentHash: `tree-${a.sha}`, ref: a.ref ?? arm } : {}),
          ...(failed ? { status: failed, checks: a.failNoScore ? [] : [{ type: 'file_exists', path: 'a.txt', passed: false }], ...(a.failNoScore ? { hiddenTests: undefined } : {}) } : {}),
        });
      }
    }
  }
  const dir = makeRun(path.join(root, name), benchDir, specs, { armIds: armOrder, taskIds: tasks, ...config });
  return { dir, benchDir };
}

const mk = () => tmp();

module.exports = { fixtureRun, mk, SHA, POINT, TASKS6, write };
