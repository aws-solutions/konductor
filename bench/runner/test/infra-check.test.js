// SPDX-License-Identifier: Apache-2.0
'use strict';

// A study where every run errored or ended in under a second is flagged as an infrastructure failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { infraFailure } = require('../lib/infra-check.js');

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
