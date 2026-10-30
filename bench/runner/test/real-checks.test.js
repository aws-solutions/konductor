// SPDX-License-Identifier: Apache-2.0
'use strict';

// The manifest-driven `tests` check: FAIL_TO_PASS is the score, PASS_TO_PASS is the regression figure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeRealBench, tmp, write, PYTEST_SKIP } = require('./real-helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const real = require('../lib/real.js');
const { runChecks } = require('../lib/checks.js');
const { aggregateHidden, aggregateRegression } = require('../lib/check-matcher.js');
const { buildResult, validateResult } = require('../lib/result.js');
const { buildCheckEnv } = require('../lib/env.js');

const CHECK = { type: 'tests', manifest: true };

function setup() {
  const b = makeRealBench({ useEnv: true });
  const task = loadTasks(b.bench).get(`real-${b.id}`);
  const work = path.join(tmp('rc-work-'), 'work');
  real.materializeInto(task, work, { cache: b.cache });
  const home = tmp('rc-home-');
  const { env } = buildCheckEnv(process.env, { home, tmpdir: path.join(home, 'tmp'), konductor: false });
  fs.mkdirSync(env.TMPDIR, { recursive: true });
  const opts = () => ({ env, hiddenDir: task.hiddenDir, real: real.testSpec(task), scratchDir: path.join(home, 'scratch'), pristineDir: task.fixtureDir });
  return { b, task, work, opts };
}

const fixIt = (work) => write(path.join(work, 'pkg/mod.py'), 'def add(a, b):\n    return a + b\n');

test('on the unfixed tree FAIL_TO_PASS fails, the regression figure is full, and the hidden file never reaches the workspace', { skip: PYTEST_SKIP }, () => {
  const s = setup();
  try {
    const [r] = runChecks(s.work, [CHECK], s.opts());
    assert.equal(r.passed, false);
    assert.deepEqual(r.tests, { passed: 0, total: 1, unparsed: false });
    assert.deepEqual(r.regression, { passed: 1, total: 1 });
    assert.match(r.detail, /FAIL_TO_PASS 0\/1, PASS_TO_PASS 1\/1/);
    assert.equal(fs.existsSync(path.join(s.work, 'tests/test_add.py')), false);
  } finally { s.b.done(); }
});

test('with the fix both figures are full and the check passes', { skip: PYTEST_SKIP }, () => {
  const s = setup();
  try {
    fixIt(s.work);
    const [r] = runChecks(s.work, [CHECK], s.opts());
    assert.equal(r.passed, true, r.detail);
    assert.deepEqual(r.tests, { passed: 1, total: 1, unparsed: false });
    assert.deepEqual(r.regression, { passed: 1, total: 1 });
  } finally { s.b.done(); }
});

test('breaking an existing test keeps FAIL_TO_PASS but is counted as a regression and fails the check', { skip: PYTEST_SKIP }, () => {
  const s = setup();
  try {
    fixIt(s.work);
    write(path.join(s.work, 'tests/test_ident.py'), 'def test_ident():\n    assert 1 == 2\n');
    const [r] = runChecks(s.work, [CHECK], s.opts());
    assert.deepEqual(r.tests, { passed: 1, total: 1, unparsed: false });
    assert.deepEqual(r.regression, { passed: 0, total: 1 });
    assert.equal(r.passed, false);
  } finally { s.b.done(); }
});

test('the PR test file the agent wrote at the same path is replaced by the real one', { skip: PYTEST_SKIP }, () => {
  const s = setup();
  try {
    write(path.join(s.work, 'tests/test_add.py'), 'def test_add():\n    assert True\n');
    const [r] = runChecks(s.work, [CHECK], s.opts());
    assert.deepEqual(r.tests, { passed: 0, total: 1, unparsed: false }, 'the agent cannot satisfy the hidden test by writing its own');
  } finally { s.b.done(); }
});

test('a tree that cannot be collected gives an unparsed result with the known totals', () => {
  const s = setup();
  try {
    write(path.join(s.work, 'tests/conftest.py'), 'this is not python (\n');
    const [r] = runChecks(s.work, [CHECK], s.opts());
    assert.equal(r.passed, false);
    assert.deepEqual(r.tests, { passed: 0, total: 1, unparsed: true });
    assert.deepEqual(r.regression, { passed: 0, total: 1 });
  } finally { s.b.done(); }
});

test('a missing manifest entry or hidden directory is an unparsed result, not a crash', () => {
  const s = setup();
  try {
    const [r] = runChecks(s.work, [CHECK], { ...s.opts(), real: undefined });
    assert.equal(r.passed, false);
    assert.equal(r.tests.unparsed, true);
  } finally { s.b.done(); }
});

test('aggregateRegression sums the regression figures and is null without any', () => {
  assert.equal(aggregateRegression([{ type: 'file_exists', passed: true }]), null);
  assert.deepEqual(aggregateRegression([{ type: 'tests', regression: { passed: 3, total: 4 } }, { type: 'tests', regression: { passed: 1, total: 1 } }]), { passed: 4, total: 5 });
  assert.deepEqual(aggregateHidden([{ type: 'tests', tests: { passed: 1, total: 2, unparsed: false }, regression: { passed: 3, total: 4 } }]), { passed: 1, total: 2, unparsed: false });
});

test('a result carries FAIL_TO_PASS as hiddenTests and PASS_TO_PASS as regressionTests and validates', () => {
  const checks = [{ type: 'tests', passed: false, detail: 'x', tests: { passed: 1, total: 2, unparsed: false }, regression: { passed: 9, total: 10 } }];
  const arm = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, vanilla: true, agent: null, harness: 'none' };
  const task = { id: 'real-x', class: 'real', target: null };
  const r = buildResult({
    arm, task, replicate: 1, config: { model: 'claude-sonnet-5.5', effort: 'high' }, exec: { timedOut: false, exitCode: 0, wallClockMs: 1 },
    agg: { runFinishedStatus: 'success', credits: 1, meteringEntries: 1, toolCalls: 0, workToolCalls: 0, toolNames: {}, subagentCalls: 0 },
    session: null, checks, transcript: null, meta: {},
  });
  assert.deepEqual(r.hiddenTests, { passed: 1, total: 2, unparsed: false });
  assert.deepEqual(r.regressionTests, { passed: 9, total: 10 });
  assert.deepEqual(validateResult(r), []);
  const none = buildResult({ arm, task, replicate: 1, config: { model: 'm', effort: 'e' }, exec: { timedOut: false, exitCode: 0, wallClockMs: 1 }, agg: null, session: null, checks: [], transcript: null, meta: {} });
  assert.equal(none.regressionTests, null);
});

test('fixture_unchanged with allowAdditions accepts new files but not edits or deletions of existing ones', () => {
  const s = setup();
  try {
    const check = { type: 'fixture_unchanged', path: 'tests', allowAdditions: true };
    const strict = { type: 'fixture_unchanged', path: 'tests' };
    const run = (c) => runChecks(s.work, [c], s.opts())[0];
    assert.equal(run(check).passed, true);
    write(path.join(s.work, 'tests/test_new.py'), 'def test_new():\n    pass\n');
    assert.equal(run(check).passed, true, 'a new test file is allowed');
    assert.equal(run(strict).passed, false, 'without the flag the file set must match');
    write(path.join(s.work, 'tests/test_ident.py'), 'def test_ident():\n    assert True\n');
    const edited = run(check);
    assert.equal(edited.passed, false);
    assert.match(edited.detail, /content differs: test_ident\.py/);
    fs.rmSync(path.join(s.work, 'tests/test_ident.py'));
    const deleted = run(check);
    assert.equal(deleted.passed, false);
    assert.match(deleted.detail, /missing 1/);
  } finally { s.b.done(); }
});
