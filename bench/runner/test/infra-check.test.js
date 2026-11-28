// SPDX-License-Identifier: Apache-2.0
'use strict';

// A study where every run errored or ended in under a second is flagged as an infrastructure failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { infraFailure, studyInfraCheck, CONTROL_SUITE_SHORT_RUN_NOTE } = require('../lib/infra-check.js');

const r = (status, wallClockMs) => ({ status, wallClockMs });

test('all runs errored, or all under one second, or a mix of both, is an infra failure', () => {
  const errs = infraFailure([r('error', null), r('error', 5)]);
  assert.deepEqual([errs.runs, errs.errored, errs.quick], [2, 2, 0]);
  assert.equal(infraFailure([r('success', 400), r('success', 999)]).quick, 2);
  const mixed = infraFailure([r('error', null), r('success', 10)]);
  assert.equal(mixed.errored, 1);
  assert.equal(mixed.quick, 1);
  assert.match(mixed.reason, /infrastructure failure/);
});

test('one run that did real work clears the flag', () => {
  assert.equal(infraFailure([r('error', null), r('success', 1000)]), null);
  assert.equal(infraFailure([r('error', null), r('timeout', 60000)]), null);
});

test('a run the bench stopped early on purpose (earlyStopped) is a result, not an infra failure (D-299)', () => {
  const stopped = { status: 'error', wallClockMs: 32506, flags: ['earlyStopped'], error: 'stopped early: max-tool-calls (8) | the run was ended by a signal' };
  assert.equal(infraFailure([stopped]), null);
  assert.equal(infraFailure([stopped, r('error', null)]), null);
  assert.ok(infraFailure([{ ...stopped, flags: ['creditLimit'] }]), 'a credit-limit kill is not a planned stop');
});

test('budget-skipped runs are ignored, and a study with none left is not flagged', () => {
  assert.equal(infraFailure([r('budget_skipped', null)]), null);
  assert.equal(infraFailure([]), null);
  assert.ok(infraFailure([r('budget_skipped', null), r('error', null)]));
});

test('the driver sets exit code 5 and records infraFailure in summary.json', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-cmd.js'), 'utf8');
  assert.match(src, /infraFailure: infra/);
  assert.match(src, /process\.exitCode = 5/);
});

test('BENCH_TEST_MODE lifts the one-second floor but errored runs still count as an infra failure', () => {
  const before = process.env.BENCH_TEST_MODE;
  process.env.BENCH_TEST_MODE = '1';
  try {
    assert.equal(infraFailure([r('success', 5)]), null);
    assert.equal(infraFailure([r('error', 5)]).errored, 1);
  } finally {
    if (before === undefined) delete process.env.BENCH_TEST_MODE; else process.env.BENCH_TEST_MODE = before;
  }
  assert.equal(infraFailure([r('success', 5)]).quick, 1);
});

const QUICK = [r('success', 40), r('success', 80)];

test('a plant control suite with sub-second trials passes the check and records why', () => {
  assert.deepEqual(studyInfraCheck(QUICK, { control: true, counted: false }), { infra: null, skipped: CONTROL_SUITE_SHORT_RUN_NOTE });
  assert.match(CONTROL_SUITE_SHORT_RUN_NOTE, /^control suite: short-run check skipped/);
});

test('a counted plant suite, or a real Kiro CLI pilot that is not counted, with the same timing still fails the check', () => {
  for (const suite of [{ control: false, counted: true }, { control: false, counted: false }]) {
    const { infra, skipped } = studyInfraCheck(QUICK, suite);
    assert.equal(infra.quick, 2);
    assert.equal(skipped, null);
  }
});

test('a non-plant suite is checked as before', () => {
  assert.equal(studyInfraCheck(QUICK, null).infra.quick, 2);
  assert.equal(studyInfraCheck(QUICK, null).skipped, null);
});

test('the driver logs the skip reason and writes it to summary.json', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'run-cmd.js'), 'utf8');
  assert.match(src, /studyInfraCheck\(results, plantSuite\)/);
  assert.match(src, /infraCheckSkipped/);
});
