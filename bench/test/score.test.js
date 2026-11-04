// SPDX-License-Identifier: Apache-2.0
/**
 * Scoring tests: how stored judgments become the deltas and refusals that aggregation reads.
 * Pure.
 * Run: node --test bench/test/score.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { judgmentOutcome, collectOutcomes } = require('../lib/score');
const { aggregateSkill, STATUS } = require('../lib/aggregate');
const { expectedJudgment, makeJudgment } = require('./support/records');
const { overallReply } = require('./support/run-fixture');

const stored = (fields, change = {}) => makeJudgment(expectedJudgment(change), fields);
const reply = (a, b) => overallReply(a, b);

test('a usable reply is un-blinded: the gap is always with minus without', () => {
  const withFirst = stored({ raw_text: reply(5, 2) }, { order: 'with-first' });
  assert.deepEqual(judgmentOutcome(withFirst, 'overall'), {
    kind: 'scored',
    delta: 3,
    score_with: 5,
    score_without: 2,
  });
  const withoutFirst = stored({ raw_text: reply(5, 2) }, { order: 'without-first' });
  assert.deepEqual(judgmentOutcome(withoutFirst, 'overall'), {
    kind: 'scored',
    delta: -3,
    score_with: 2,
    score_without: 5,
  });
});

test('the reply text is read again; the stored parsed field is not trusted', () => {
  const tampered = stored({
    raw_text: reply(2, 5),
    parsed: { winner: 'A', score_a: 5, score_b: 1, reason: 'x', problem: null },
  });
  assert.equal(judgmentOutcome(tampered, 'overall').delta, -3);
});

test('a stored ok judgment whose text no longer reads is refused, not scored', () => {
  const stale = stored({ raw_text: '{"winner":"A","score_a":2,"score_b":5}' });
  const got = judgmentOutcome(stale, 'overall');
  assert.equal(got.kind, 'refused');
  assert.match(got.problem, /contradicts the scores/);
});

test('an unparsable reply, a refusal and an invalid call are refused', () => {
  assert.equal(judgmentOutcome(stored({ status: 'unparsable', raw_text: 'no json', parsed: null }), 'overall').kind, 'refused');
  assert.equal(judgmentOutcome(stored({ status: 'refused', raw_text: null, parsed: null }), 'overall').kind, 'refused');
  assert.equal(judgmentOutcome(stored({ status: 'invalid', raw_text: null, parsed: null }), 'overall').kind, 'refused');
  assert.equal(judgmentOutcome(stored({ status: 'unparsable', raw_text: null, parsed: null }), 'overall').kind, 'refused');
});

test('a transient failure and no judgment are missing', () => {
  assert.deepEqual(judgmentOutcome(stored({ status: 'transient', raw_text: null, parsed: null }), 'overall'), {
    kind: 'missing',
  });
  assert.deepEqual(judgmentOutcome(null, 'overall'), { kind: 'missing' });
});

test('the items scale needs the checklist length', () => {
  const text = '{"items_a":["MET","MET"],"items_b":["MISSING","MISSING"]}';
  const rec = stored({ raw_text: text }, { order: 'with-first', scale: 'items' });
  assert.equal(judgmentOutcome(rec, 'items', { rubricLength: 2 }).delta, 4);
  assert.equal(judgmentOutcome(rec, 'items', { rubricLength: 3 }).kind, 'refused');
});

const entry = (taskId, seat, order, record, rubricLength = 2) => ({ taskId, seat, order, record, rubricLength });

test('collectOutcomes keys scores by task, seat and order, and marks refusals', () => {
  const out = collectOutcomes(
    [
      entry('task-1', 'seat-a', 'with-first', stored({ raw_text: reply(4, 2) })),
      entry('task-1', 'seat-b', 'without-first', stored({ raw_text: reply(4, 2) }, { order: 'without-first' })),
      entry('task-1', 'seat-c', 'with-first', stored({ status: 'unparsable', raw_text: 'x', parsed: null })),
      entry('task-1', 'seat-d', 'with-first', null),
      entry('task-2', 'seat-a', 'with-first', stored({ status: 'transient', raw_text: null, parsed: null })),
    ],
    'overall',
  );
  assert.deepEqual(out.deltas, {
    'task-1': { 'seat-a': { 'with-first': 2 }, 'seat-b': { 'without-first': -2 }, 'seat-c': { 'with-first': null } },
  });
  assert.deepEqual(out.refused, { 'task-1': { 'seat-c': { 'with-first': true } } });
});

test('through aggregation: a refused seat is invalid, a missing seat is unscored, a scored seat is scored', () => {
  const entries = [
    entry('task-1', 'seat-a', 'with-first', stored({ raw_text: reply(4, 2) })),
    entry('task-1', 'seat-b', 'with-first', stored({ status: 'unparsable', raw_text: 'x', parsed: null })),
    entry('task-1', 'seat-c', 'with-first', stored({ status: 'transient', raw_text: null, parsed: null })),
  ];
  const { deltas, refused } = collectOutcomes(entries, 'overall');
  const result = aggregateSkill({
    skill: 'toy-skill',
    taskSet: { tasks: [{ id: 'task-1', target_section: 'S1' }] },
    deltas,
    refused,
    loaded: { 'task-1': true },
    cfg: { judges: [{ seat: 'seat-a' }, { seat: 'seat-b' }, { seat: 'seat-c' }] },
  });
  const pair = result.pairs[0];
  assert.deepEqual(pair.judge_status, {
    'seat-a': STATUS.SCORED,
    'seat-b': STATUS.INVALID,
    'seat-c': STATUS.UNSCORED,
  });
  assert.equal(pair.scored, false, 'one scored seat is not a panel');
  assert.equal(pair.status, STATUS.INVALID);
});
