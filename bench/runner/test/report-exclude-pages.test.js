// SPDX-License-Identifier: Apache-2.0
'use strict';

// DEBT D-295: a task whose needed agent (load-fairness.json `needsAgent`) started no run leaves the run report, the platform
// verdict and the orchestrator pass alike, and each page says so. Each page built from a run that also holds such a task
// must give the same numbers as the page built from the run without it. In-process; no bench.js, no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixtureRun, mk } = require('./verdict-fixtures.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { generateRunReport } = require('../../report/generate.js');
const { buildVerdict } = require('../../report/verdict.js');
const { buildOrchestratorPass } = require('../../report/orchpass.js');

const CMUX = 't12-cmux-parallel-merge';
const arms = { vanilla: { hidden: [6, 7, 8] }, konductor: { hidden: [8, 9, 7] } };
const cmuxArms = { vanilla: { hiddenByTask: { t1: [6, 7, 8], t2: [6, 7, 8], [CMUX]: 0 } }, konductor: { hiddenByTask: { t1: [8, 9, 7], t2: [8, 9, 7], [CMUX]: 10 } } };

/** Two runs on one bench: `plain` has t1 and t2, `withCmux` has the same runs of t1 and t2 plus t12-cmux in no cmux agent. */
function pair(root) {
  const plain = fixtureRun(root, 'plain', { arms, reps: 3 });
  const withCmux = fixtureRun(root, 'cmux', { arms: cmuxArms, reps: 3, tasks: ['t1', 't2', CMUX], bench: plain.benchDir });
  return { benchDir: plain.benchDir, plain: plain.dir, withCmux: withCmux.dir };
}

const strip = (v) => JSON.parse(JSON.stringify(v.arms, (k, x) => (k === 'dirs' || k === 'dir' ? undefined : x)));
const LEFT_OUT = new RegExp(`${CMUX} \\(needs konductor-cmux-orchestrator`);

test('the run report leaves out a task whose needed agent started no run, and says so', () => {
  const root = mk();
  try {
    const p = pair(root);
    const tasks = loadTasks(p.benchDir);
    const go = (dir, name) => {
      generateRunReport({ run: loadRun(dir), tasks, baseline: 'vanilla', out: path.join(root, name), detail: 'full', format: 'md', defaultDir: dir });
      return fs.readFileSync(path.join(root, name, 'report.md'), 'utf8');
    };
    go(p.plain, 'r-plain');
    const md = go(p.withCmux, 'r-cmux');
    assert.match(md, LEFT_OUT);
    assert.doesNotMatch(md.replace(LEFT_OUT, ''), new RegExp(`\\| ${CMUX} `));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the platform verdict leaves the task out, names it in its notes, and matches the verdict without it', () => {
  const root = mk();
  try {
    const p = pair(root);
    const base = buildVerdict({ dirs: [p.plain], benchDir: p.benchDir, withSensitivity: false });
    const v = buildVerdict({ dirs: [p.withCmux], benchDir: p.benchDir, withSensitivity: false });
    assert.deepEqual(strip(v), strip(base));
    assert.ok(v.notes.some((n) => LEFT_OUT.test(n)), v.notes.join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the orchestrator pass leaves the task out, names it in its notes, and matches the pass without it', () => {
  const root = mk();
  try {
    const p = pair(root);
    const cells = (o) => o.cells.map((c) => JSON.parse(JSON.stringify(c.arms, (k, x) => (k === 'dirs' || k === 'dir' ? undefined : x))));
    const base = buildOrchestratorPass({ dirs: [p.plain], benchDir: p.benchDir, withSensitivity: false });
    const o = buildOrchestratorPass({ dirs: [p.withCmux], benchDir: p.benchDir, withSensitivity: false });
    assert.deepEqual(cells(o), cells(base));
    assert.ok(o.notes.some((n) => LEFT_OUT.test(n)), o.notes.join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
