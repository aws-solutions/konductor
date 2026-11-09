// SPDX-License-Identifier: Apache-2.0
'use strict';

// The complex suite takes its tasks from bench/complex, a suite-declared extra directory. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTasks, loadSuite, suiteExtraDirs, SUITE_NAMES, BENCH_DIR } = require('../lib/tasks.js');

const COMPLEX = path.join(BENCH_DIR, 'complex');
const files = fs.readdirSync(COMPLEX).filter((f) => f.endsWith('.json')).sort();

test('complex is a registered suite with three arms, one replicate and one run at a time', () => {
  assert.ok(SUITE_NAMES.includes('complex'));
  const s = loadSuite('complex', loadTasks(BENCH_DIR, { extraDirs: [COMPLEX] }), BENCH_DIR);
  assert.deepEqual(s.arms, ['vanilla', 'v1.2.0', 'main']);
  assert.equal(s.replicates, 1);
  assert.equal(s.parallel, 1);
});

test('the suite resolves its extra directory and lists every task file in it', () => {
  const dirs = suiteExtraDirs('complex', BENCH_DIR);
  assert.deepEqual(dirs, [COMPLEX]);
  const tasks = loadTasks(BENCH_DIR, { extraDirs: dirs });
  const s = loadSuite('complex', tasks, BENCH_DIR);
  assert.deepEqual([...s.taskIds].sort(), files.map((f) => f.replace(/\.json$/, '')));
  for (const id of s.taskIds) assert.ok(tasks.has(id), id);
});

test('every complex task has hidden tests, a 1800 s timeout, at most six rubric items and a cx- id', () => {
  const tasks = loadTasks(BENCH_DIR, { extraDirs: [COMPLEX] });
  for (const f of files) {
    const t = tasks.get(f.replace(/\.json$/, ''));
    assert.match(t.id, /^cx-/);
    assert.equal(t.class, 'complex');
    assert.equal(t.timeoutSec, 1800);
    assert.ok(t.rubric.length >= 3 && t.rubric.length <= 6, t.id);
    assert.ok(t.checks.some((c) => c.type === 'tests'), t.id);
    assert.ok(fs.existsSync(path.join(COMPLEX, 'solutions', t.id)), `${t.id} solution`);
    assert.ok(fs.existsSync(path.join(COMPLEX, 'stubs', t.id)), `${t.id} stub`);
  }
});
