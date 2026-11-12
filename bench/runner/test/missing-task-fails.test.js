// SPDX-License-Identifier: Apache-2.0
'use strict';

// judge and contrast stop with a nonzero exit and the task id when a run's task definition is not loaded.
// Passing the extra tasks directory that holds it keeps working. The judge backend is never reached (--plan).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { contrastRun } = require('../../report/contrast.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks, requireTasks } = require('../lib/tasks.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const JUDGES = ['gpt-test', 'deepseek-test', 'glm-test'];

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const extra = path.join(root, 'extra');
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(extra, 'x1.json'), JSON.stringify({ ...t1, id: 'x1', class: 'review' }));
  const specs = ['vanilla', 'main'].map((arm) => ({ arm, task: 'x1' }));
  const runDir = makeRun(path.join(root, 'run'), bench, specs, { taskIds: ['x1'] });
  return { root, bench, extra, runDir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const cli = (s, cmd, args) => spawnSync(process.execPath, [BENCH_JS, cmd, '--run', s.runDir, '--bench-dir', s.bench, ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR },
});
const judgeArgs = ['--judges', JUDGES.join(','), '--judge-cmd', 'false', '--plan'];

test('requireTasks names every missing task id', () => {
  const tasks = new Map([['a', {}]]);
  requireTasks(['a'], tasks);
  assert.throws(() => requireTasks(['a', 'z2', 'z1', 'z1'], tasks), /"z1", "z2"/);
});

test('contrastRun throws naming the task when its definition is not loaded', () => {
  const s = setup();
  try {
    assert.throws(() => contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench) }), /"x1"/);
    assert.ok(contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench, { extraDirs: [s.extra] }) }));
  } finally { s.done(); }
});

test('contrast exits nonzero naming the task without --extra-tasks, and succeeds with it', () => {
  const s = setup();
  try {
    const bad = cli(s, 'contrast', ['--out', path.join(s.root, 'out1')]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /"x1"/);
    const ok = cli(s, 'contrast', ['--extra-tasks', s.extra, '--out', path.join(s.root, 'out2')]);
    assert.equal(ok.status, 0, ok.stderr);
  } finally { s.done(); }
});

test('judge exits nonzero naming the task without --extra-tasks, and plans with it', () => {
  const s = setup();
  try {
    const bad = cli(s, 'judge', judgeArgs);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /"x1"/);
    const ok = cli(s, 'judge', [...judgeArgs, '--extra-tasks', s.extra]);
    assert.equal(ok.status, 0, ok.stderr);
  } finally { s.done(); }
});
