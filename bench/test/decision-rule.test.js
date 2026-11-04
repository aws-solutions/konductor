// SPDX-License-Identifier: Apache-2.0
/**
 * Decision rule unit tests: the named rule `paired-t/v1`, its numbers, the t tables and the digest.
 * Run: node --test bench/test/decision-rule.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rule = require('../lib/decision-rule');
const { specSha256 } = require('../lib/treatment-check');

const HEX = /^[0-9a-f]{64}$/;

test('the rule is named paired-t/v1 with the pinned version, numbers and gate identifier', () => {
  assert.equal(rule.DECISION_RULE_NAME, 'paired-t/v1');
  assert.equal(rule.DECISION_RULE_VERSION, 1);
  assert.equal(rule.WORD_CHECK_GATE_ID, 'word-check-veto/v1');
  assert.deepEqual(
    [rule.KEEP_FLOOR, rule.PRUNE_FLOOR, rule.MIN_DECISION_PAIRS, rule.MIN_SEATS_PER_PAIR],
    [0.1, -0.2, 8, 2],
  );
});

test('the header flags the thresholds as provisional', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'decision-rule.js'), 'utf8');
  assert.match(src.split('*/')[0], /PROVISIONAL/);
  assert.equal(src.split('\n')[0], '// SPDX-License-Identifier: Apache-2.0');
});

test('t critical values: known answers for both tables, clamped to the first and last entry', () => {
  // Published two-sided 95% (97.5% one-sided) and one-sided 99% Student t values.
  const t975 = { 1: 12.706, 2: 4.303, 7: 2.365, 10: 2.228, 20: 2.086, 29: 2.045, 30: 2.042 };
  const t990 = { 1: 31.821, 2: 6.965, 7: 2.998, 10: 2.764, 20: 2.528, 29: 2.462, 30: 2.457 };
  for (const [df, want] of Object.entries(t975)) {
    assert.equal(rule.tCritical(Number(df), rule.T_975), want, `T_975 df ${df}`);
  }
  for (const [df, want] of Object.entries(t990)) {
    assert.equal(rule.tCritical(Number(df), rule.T_990), want, `T_990 df ${df}`);
  }
  assert.equal(rule.T_975.length, 30);
  assert.equal(rule.T_990.length, 30);
  for (const table of [rule.T_975, rule.T_990]) {
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i] < table[i - 1], 'each degree of freedom lowers the value');
    }
  }
  assert.ok(rule.T_990.every((v, i) => v > rule.T_975[i]), 'the 99% value is above the 97.5% value');
  assert.equal(rule.tCritical(0, rule.T_975), 12.706, 'below 1 df uses the 1 df value');
  assert.equal(rule.tCritical(-5, rule.T_990), 31.821);
  assert.equal(rule.tCritical(31, rule.T_975), 2.042, 'df 31 clamps to the 30 df value');
  assert.equal(rule.tCritical(1000, rule.T_975), 2.042);
  assert.equal(rule.tCritical(1000, rule.T_990), 2.457);
  assert.equal(rule.tCritical(NaN, rule.T_975), 2.042, 'a df that is not a number reads the last entry');
});

test('the tables cannot be edited at run time', () => {
  assert.ok(Object.isFrozen(rule.T_975));
  assert.ok(Object.isFrozen(rule.T_990));
});

test('the digest is a stable sha256 and equals the digest of the fields it covers', () => {
  assert.match(rule.decisionRuleSha256(), HEX);
  assert.equal(rule.decisionRuleSha256(), rule.decisionRuleSha256());
  assert.equal(rule.decisionRuleSha256(), rule.digestRuleFields(rule.decisionRuleFields()));
});

test('the digest covers the version, every threshold, both tables and the gate identifier', () => {
  const fields = rule.decisionRuleFields();
  assert.deepEqual(Object.keys(fields).sort(), [
    'KEEP_FLOOR',
    'MIN_DECISION_PAIRS',
    'MIN_SEATS_PER_PAIR',
    'PRUNE_FLOOR',
    'T_975',
    'T_990',
    'decision_rule_name',
    'decision_rule_version',
    'treatment_specs',
    'word_check_gate',
  ]);
  // The covered values are the exported ones, so an edit to an export reaches the digest.
  assert.equal(fields.decision_rule_name, rule.DECISION_RULE_NAME);
  assert.equal(fields.decision_rule_version, rule.DECISION_RULE_VERSION);
  assert.equal(fields.word_check_gate, rule.WORD_CHECK_GATE_ID);
  assert.equal(fields.KEEP_FLOOR, rule.KEEP_FLOOR);
  assert.equal(fields.PRUNE_FLOOR, rule.PRUNE_FLOOR);
  assert.equal(fields.MIN_DECISION_PAIRS, rule.MIN_DECISION_PAIRS);
  assert.equal(fields.MIN_SEATS_PER_PAIR, rule.MIN_SEATS_PER_PAIR);
  assert.equal(fields.treatment_specs, specSha256());
  assert.deepEqual(fields.T_975, rule.T_975);
  assert.deepEqual(fields.T_990, rule.T_990);
});

test('changing any threshold, version, identifier or table entry changes the digest', () => {
  const base = rule.decisionRuleFields();
  const baseDigest = rule.digestRuleFields(base);
  const changes = {
    decision_rule_name: 'paired-t/v2',
    decision_rule_version: base.decision_rule_version + 1,
    word_check_gate: 'word-check-veto/v2',
    KEEP_FLOOR: base.KEEP_FLOOR + 0.01,
    PRUNE_FLOOR: base.PRUNE_FLOOR - 0.01,
    MIN_DECISION_PAIRS: base.MIN_DECISION_PAIRS + 1,
    MIN_SEATS_PER_PAIR: base.MIN_SEATS_PER_PAIR + 1,
    treatment_specs: 'f'.repeat(64),
  };
  for (const [key, value] of Object.entries(changes)) {
    assert.notEqual(rule.digestRuleFields({ ...base, [key]: value }), baseDigest, key);
  }
  for (const table of ['T_975', 'T_990']) {
    for (let i = 0; i < base[table].length; i++) {
      const edited = base[table].map((v, j) => (j === i ? v + 0.001 : v));
      assert.notEqual(rule.digestRuleFields({ ...base, [table]: edited }), baseDigest, `${table}[${i}]`);
    }
    assert.notEqual(
      rule.digestRuleFields({ ...base, [table]: base[table].slice(0, -1) }),
      baseDigest,
      `${table} shortened`,
    );
  }
  assert.notEqual(
    rule.digestRuleFields({ ...base, extra_field: 1 }),
    baseDigest,
    'a new covered field changes it too',
  );
});

test('the digest does not hash the source text of a function', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'decision-rule.js'), 'utf8');
  assert.ok(!/\.toString\(\)/.test(src));
});
