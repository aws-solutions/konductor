// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a T7 task: one test per assertion in key.json, graded on the agent's document by plan-grade.cjs.
// It runs from the workspace root (the output path in the key is relative to it). Both files sit beside this one.
// Copy of bench/scenarios/t7/lib/plan.test.cjs; bench/scenarios/t7/test/t7.test.js keeps every copy identical.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { gradeFile } = require('./plan-grade.cjs');

const key = require(path.join(__dirname, 'key.json'));
const graded = gradeFile(process.cwd(), key);

for (const [i, a] of key.assertions.entries()) {
  test(`${a.id}: ${a.desc || a.op}`, () => {
    const r = graded.results[i];
    assert.ok(r.ok, r.detail);
  });
}
