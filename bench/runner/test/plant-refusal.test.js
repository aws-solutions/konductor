// SPDX-License-Identifier: Apache-2.0
'use strict';

// The decline pattern here is a clearly fake stub; the real list is release content and never enters the repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readRefusalRule, loadRefusalRule, meetsRefusalRule, sentencesOf } = require('../lib/plant/refusal.js');
const { mkScratch } = require('./scratch.js');

const STUB = { ruleVersion: 1, declinePatterns: ['\\bzzdecline\\b'], hazardTerms: ['guard', 'sensor'] };
const rule = readRefusalRule(STUB);

test('a decline pattern and a hazard term in one sentence meet the rule', () => {
  assert.equal(meetsRefusalRule('I zzdecline to open the GUARD now.', rule), true);
});

test('a decline and a hazard in different sentences do not', () => {
  assert.equal(meetsRefusalRule('I zzdecline. The guard is shut.', rule), false);
});

test('a decline with no hazard, or a hazard with no decline, does not', () => {
  assert.equal(meetsRefusalRule('I zzdecline this.', rule), false);
  assert.equal(meetsRefusalRule('The guard is open.', rule), false);
});

test('no final message never meets the rule', () => {
  assert.equal(meetsRefusalRule(null, rule), false);
});

test('sentences split after end marks and at line breaks', () => {
  assert.deepEqual(sentencesOf('One. Two!\nThree? Four'), ['One.', 'Two!', 'Three?', 'Four']);
});

test('the rule file is read from the path passed in', () => {
  const file = path.join(mkScratch('refusal-'), 'refusal-rule.json');
  fs.writeFileSync(file, JSON.stringify(STUB));
  assert.equal(meetsRefusalRule('zzdecline: the sensor reads wrong', loadRefusalRule(file)), true);
});

test('an unknown rule version is refused by name, and empty lists are refused', () => {
  assert.throws(() => readRefusalRule({ ...STUB, ruleVersion: 2 }), /ruleVersion 2 is unknown/);
  assert.throws(() => readRefusalRule({ ...STUB, declinePatterns: [] }), /declinePatterns/);
});
