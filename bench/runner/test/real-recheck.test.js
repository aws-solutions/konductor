// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench.js recheck on a saved real-repository run: both test figures are recomputed from the snapshot.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeRealBench, tmp, write } = require('./real-helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const real = require('../lib/real.js');
const { recheckAll } = require('../lib/recheck.js');
const { mkResult } = require('./helpers.js');

function savedRun(b, { fixed }) {
  const runDir = tmp('rr-run-');
  const dir = path.join(runDir, 'vanilla', `real-${b.id}`, '1');
  const task = loadTasks(b.bench).get(`real-${b.id}`);
  real.materializeInto(task, path.join(dir, 'workspace'), { cache: b.cache });
  if (fixed) write(path.join(dir, 'workspace/pkg/mod.py'), 'def add(a, b):\n    return a + b\n');
  const stale = [{ type: 'tests', passed: false, detail: 'old', tests: { passed: 0, total: 1, unparsed: false } }];
  write(path.join(dir, 'result.json'), JSON.stringify(mkResult({ taskId: `real-${b.id}`, checks: stale, hiddenTests: stale[0].tests })));
  write(path.join(dir, 'stream.jsonl'), '{"type":"runFinished","data":{"status":"success"}}\n');
  write(path.join(runDir, 'run-config.json'), JSON.stringify({ suite: 'real', model: 'm', effort: 'e', taskIds: [`real-${b.id}`] }));
  return { runDir, dir };
}

test('recheck recomputes FAIL_TO_PASS into hiddenTests and PASS_TO_PASS into regressionTests', () => {
  const b = makeRealBench({ useEnv: true });
  const saved = savedRun(b, { fixed: true });
  try {
    const out = recheckAll({ runDir: saved.runDir, benchDir: b.bench });
    assert.equal(out[0].status, 'rechecked', out[0].reason);
    const r = JSON.parse(fs.readFileSync(path.join(saved.dir, 'result.json'), 'utf8'));
    assert.deepEqual(r.hiddenTests, { passed: 1, total: 1, unparsed: false });
    assert.deepEqual(r.regressionTests, { passed: 1, total: 1 });
    assert.equal(r.checksOriginal[0].detail, 'old');
    assert.equal(r.checksAllPassed, true, 'every current check of the task passes on the fixed snapshot');
  } finally { b.done(); fs.rmSync(saved.runDir, { recursive: true, force: true }); }
});

test('recheck of an unfixed snapshot keeps the regression figure and a zero score', () => {
  const b = makeRealBench({ useEnv: true });
  const saved = savedRun(b, { fixed: false });
  try {
    recheckAll({ runDir: saved.runDir, benchDir: b.bench });
    const r = JSON.parse(fs.readFileSync(path.join(saved.dir, 'result.json'), 'utf8'));
    assert.deepEqual(r.hiddenTests, { passed: 0, total: 1, unparsed: false });
    assert.deepEqual(r.regressionTests, { passed: 1, total: 1 });
  } finally { b.done(); fs.rmSync(saved.runDir, { recursive: true, force: true }); }
});
