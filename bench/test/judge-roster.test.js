// SPDX-License-Identifier: Apache-2.0
/**
 * Judge roster tests: the seat format and the panel rule (at least three seats, distinct
 * families), and the order settings. Pure; no files.
 * Run: node --test bench/test/judge-roster.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { MIN_SEATS, validateRoster, validateJudgeConfig } = require('../lib/judge-roster');
const { seat, roster } = require('./support/roster');

const problemsOf = (judges) => {
  try {
    validateRoster(judges);
  } catch (err) {
    return err;
  }
  assert.fail('expected the roster to be rejected');
  return null;
};

test('a panel of three seats with distinct families is accepted', () => {
  const judges = validateRoster(roster(3));
  assert.equal(judges.length, MIN_SEATS);
  assert.deepEqual(judges[0], seat(1));
  assert.equal(validateRoster(roster(5)).length, 5);
});

test('the validated roster is a frozen copy that keeps only the four known fields', () => {
  const input = roster(3);
  const judges = validateRoster(input);
  assert.ok(Object.isFrozen(judges));
  assert.ok(Object.isFrozen(judges[0]));
  input[0].seat = 'changed';
  assert.equal(judges[0].seat, 'seat-1');
});

test('fewer than three seats is rejected with a clear message', () => {
  for (const count of [0, 1, 2]) {
    const err = problemsOf(roster(count));
    assert.match(err.message, /judge roster is invalid/);
    assert.match(err.message, new RegExp(`needs at least 3 seats, got ${count}`));
  }
});

test('two seats from one family are rejected, naming both seats and the family', () => {
  const judges = roster(4);
  judges[2].family = judges[0].family;
  const err = problemsOf(judges);
  assert.match(err.message, /"seat-1" and "seat-3" share the family "family-1"/);
  assert.match(err.message, /each seat needs its own family/);
  assert.equal(err.problems.length, 1);
});

test('three seats that all share one family are rejected', () => {
  const judges = roster(3).map((j) => ({ ...j, family: 'one-family' }));
  assert.match(problemsOf(judges).message, /share the family "one-family"/);
});

test('a repeated seat label is rejected', () => {
  const judges = roster(3);
  judges[1].seat = judges[0].seat;
  assert.match(problemsOf(judges).message, /seat label "seat-1" is used more than once/);
});

test('every problem is reported at once', () => {
  const judges = [seat(1), { ...seat(2), family: 'family-1', model: '' }];
  const err = problemsOf(judges);
  assert.ok(err.problems.length >= 3, err.message);
  assert.match(err.message, /model must be a non-empty/);
  assert.match(err.message, /at least 3 seats/);
  assert.match(err.message, /share the family/);
});

test('a seat is checked field by field', () => {
  const bad = (change) => problemsOf([{ ...seat(1), ...change }, seat(2), seat(3)]).message;
  assert.match(bad({ seat: '../x' }), /judges\[0\]\.seat must be lower-case/);
  assert.match(bad({ seat: 'Seat A' }), /judges\[0\]\.seat/);
  assert.match(bad({ seat: undefined }), /judges\[0\]\.seat/);
  assert.match(bad({ family: '' }), /judges\[0\]\.family/);
  assert.match(bad({ family: 'a/b' }), /judges\[0\]\.family/);
  assert.match(bad({ plugin: '' }), /judges\[0\]\.plugin/);
  assert.match(bad({ plugin: 'a b' }), /judges\[0\]\.plugin/);
  assert.match(bad({ model: '   ' }), /judges\[0\]\.model/);
  assert.match(bad({ model: 'a\nb' }), /judges\[0\]\.model/);
  assert.match(bad({ model: 'x'.repeat(201) }), /judges\[0\]\.model/);
  assert.match(bad({ model: 7 }), /judges\[0\]\.model/);
});

test('an unknown field is rejected, so a misspelled key is not silently ignored', () => {
  const judges = roster(3);
  judges[1] = { ...judges[1], modelId: 'x' };
  assert.match(problemsOf(judges).message, /judges\[1\] has an unknown field "modelId"/);
});

test('a roster that is not an array of objects is rejected', () => {
  assert.match(problemsOf(undefined).message, /must be an array/);
  assert.match(problemsOf({ seat: 'x' }).message, /must be an array/);
  assert.match(problemsOf([null, [], 'x']).message, /judges\[0\] must be an object/);
});

test('the minimum panel size can be raised but the message stays clear', () => {
  assert.throws(() => validateRoster(roster(3), { minSeats: 5 }), /at least 5 seats, got 3/);
  assert.equal(validateRoster(roster(5), { minSeats: 5 }).length, 5);
});

test('validateJudgeConfig fills the order defaults: every order, both per pair', () => {
  const config = validateJudgeConfig({ judges: roster(3), unrelated: true });
  assert.deepEqual([...config.judgeOrders], ['with-first', 'without-first']);
  assert.equal(config.ordersPerPair, 2);
  assert.equal(config.judges.length, 3);
});

test('validateJudgeConfig accepts one order per pair and a custom order list', () => {
  assert.equal(validateJudgeConfig({ judges: roster(3), ordersPerPair: 1 }).ordersPerPair, 1);
  const only = validateJudgeConfig({ judges: roster(3), judgeOrders: ['without-first'] });
  assert.deepEqual([...only.judgeOrders], ['without-first']);
  assert.equal(only.ordersPerPair, 1);
});

test('validateJudgeConfig rejects a bad order list or count, and applies the panel rule', () => {
  const base = { judges: roster(3) };
  for (const change of [
    { judgeOrders: [] },
    { judgeOrders: ['with-first', 'with-first'] },
    { judgeOrders: ['first'] },
    { judgeOrders: 'with-first' },
  ]) {
    assert.throws(() => validateJudgeConfig({ ...base, ...change }), /judgeOrders/, JSON.stringify(change));
  }
  for (const ordersPerPair of [0, 3, 1.5, '1', null]) {
    assert.throws(() => validateJudgeConfig({ ...base, ordersPerPair }), /ordersPerPair/, String(ordersPerPair));
  }
  assert.throws(() => validateJudgeConfig({ judges: roster(2) }), /at least 3 seats/);
  assert.throws(() => validateJudgeConfig(null), /judge config/);
  assert.throws(() => validateJudgeConfig([]), /judge config/);
});
