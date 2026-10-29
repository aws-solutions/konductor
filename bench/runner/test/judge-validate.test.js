// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RUBRIC } = require('./helpers.js');
const { parseJsonStrict, validateRubricReply, validatePairReply } = require('../../judge/validate.js');
const { rubricScore, pairOutcome, combineOrderings } = require('../../judge/score.js');

const good = { criteria: [{ id: 'c1', verdict: 'pass', evidence: 'said so' }, { id: 'c2', verdict: 'partial', evidence: 'half' }] };

test('parseJsonStrict accepts plain JSON and one fenced block, rejects prose', () => {
  assert.equal(parseJsonStrict('{"a":1}').value.a, 1);
  assert.equal(parseJsonStrict('```json\n{"a":2}\n```').value.a, 2);
  assert.equal(parseJsonStrict('  {"a":3}\n').value.a, 3);
  assert.equal(parseJsonStrict('Sure! {"a":1}').ok, false);
  assert.equal(parseJsonStrict('{"a":').ok, false);
  assert.equal(parseJsonStrict('').ok, false);
});

test('validateRubricReply requires exactly the rubric ids with valid verdicts', () => {
  assert.equal(validateRubricReply(good, RUBRIC).ok, true);
  const missing = validateRubricReply({ criteria: [good.criteria[0]] }, RUBRIC);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /missing.*c2/);
  const dup = validateRubricReply({ criteria: [good.criteria[0], good.criteria[0], good.criteria[1]] }, RUBRIC);
  assert.equal(dup.ok, false);
  const extra = validateRubricReply({ criteria: [...good.criteria, { id: 'zz', verdict: 'pass', evidence: 'e' }] }, RUBRIC);
  assert.equal(extra.ok, false);
  const bad = validateRubricReply({ criteria: [{ id: 'c1', verdict: 'great', evidence: 'e' }, good.criteria[1]] }, RUBRIC);
  assert.equal(bad.ok, false);
  assert.equal(validateRubricReply({ criteria: [{ id: 'c1', verdict: 'pass' }, good.criteria[1]] }, RUBRIC).ok, false);
  assert.equal(validateRubricReply('nope', RUBRIC).ok, false);
});

test('validatePairReply accepts A, B, tie only', () => {
  assert.equal(validatePairReply({ winner: 'A', reason: 'r' }).ok, true);
  assert.equal(validatePairReply({ winner: 'tie', reason: 'r' }).ok, true);
  assert.equal(validatePairReply({ winner: 'C', reason: 'r' }).ok, false);
  assert.equal(validatePairReply({ reason: 'r' }).ok, false);
});

test('rubricScore is the weighted sum with pass=1 partial=0.5 fail=0, normalized', () => {
  const s = (a, b) => rubricScore(RUBRIC, [{ id: 'c1', verdict: a }, { id: 'c2', verdict: b }]);
  assert.equal(s('pass', 'pass'), 1);
  assert.equal(s('fail', 'fail'), 0);
  assert.equal(s('pass', 'fail'), 0.25);
  assert.equal(s('fail', 'pass'), 0.75);
  assert.equal(s('partial', 'partial'), 0.5);
  assert.equal(s('pass', 'partial'), (1 + 1.5) / 4);
});

test('pairOutcome maps the winning position back to the arm', () => {
  assert.equal(pairOutcome('A', true), 'win');
  assert.equal(pairOutcome('B', true), 'loss');
  assert.equal(pairOutcome('A', false), 'loss');
  assert.equal(pairOutcome('B', false), 'win');
  assert.equal(pairOutcome('tie', true), 'tie');
});

test('combineOrderings agrees, or ties with positionInconsistent', () => {
  assert.deepEqual(combineOrderings('win', 'win'), { verdict: 'win', positionInconsistent: false });
  assert.deepEqual(combineOrderings('loss', 'loss'), { verdict: 'loss', positionInconsistent: false });
  assert.deepEqual(combineOrderings('tie', 'tie'), { verdict: 'tie', positionInconsistent: false });
  assert.deepEqual(combineOrderings('win', 'loss'), { verdict: 'tie', positionInconsistent: true });
  assert.deepEqual(combineOrderings('win', 'tie'), { verdict: 'tie', positionInconsistent: true });
  assert.deepEqual(combineOrderings(null, 'win'), { verdict: null, positionInconsistent: false });
});
