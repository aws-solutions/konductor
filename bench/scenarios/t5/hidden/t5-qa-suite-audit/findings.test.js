// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a findings-key task, copied next to `findings-kit/` (key.json, findings-key.js).
// key.json: { "outputFile": "docs/TEST-PLAN.md", "findingsKey": [ {id, location, severity, fix, fixMin?} ] }
// Per key item: one test that it is named in the output's JSON block with a fitting fix, one that the severity
// is within one level. One last test checks the list stays short and precise.
const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { gradeFindings, readFindingsBlock } = require('./findings-kit/findings-key.js');

const { outputFile, findingsKey } = JSON.parse(fs.readFileSync(path.join(__dirname, 'findings-kit/key.json'), 'utf8'));
let text = '';
try { text = fs.readFileSync(path.join(__dirname, outputFile), 'utf8'); } catch { /* a missing file fails every test below */ }
const reported = readFindingsBlock(text);
const whole = gradeFindings(reported, findingsKey);

describe('findings', () => {
  for (const k of findingsKey) {
    const one = gradeFindings(reported, [k]);
    test(`${k.id}: named with a fitting test`, () => {
      assert.ok(reported, `no JSON findings block in ${outputFile}`);
      assert.ok(whole.matched.includes(k.id), `${k.id} not found`);
      assert.ok(one.fixAccuracy === 1, `${k.id}: the planned test does not cover it`);
    });
    test(`${k.id}: severity within one level`, () => {
      assert.ok(whole.matched.includes(k.id), `${k.id} not found`);
      assert.ok(one.severityAccuracy >= 0.5, `${k.id}: severity too far off`);
    });
  }
  test('the list is short and precise', () => {
    assert.ok(reported, 'no findings block');
    assert.ok(whole.lengthTerm === 1 && whole.precision >= 0.4, `reported ${whole.reported}, precision ${whole.precision.toFixed(2)}`);
  });
});
