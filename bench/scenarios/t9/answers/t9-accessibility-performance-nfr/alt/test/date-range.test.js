import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeProblems } from '../src/date-range.js';

test('no problems for empty or ordered boxes', () => {
  assert.deepEqual(rangeProblems('', ''), []);
  assert.deepEqual(rangeProblems('2025-01-01', '2025-01-31'), []);
  assert.deepEqual(rangeProblems('05.01.2025', '5/1/2025'), []);
});

test('To before From lands on To', () => {
  const [p, ...rest] = rangeProblems('2025-05-02', '2025-05-01');
  assert.equal(p.field, 'to');
  assert.equal(rest.length, 0);
});

test('an impossible day lands on its own field', () => {
  assert.deepEqual(rangeProblems('2025-02-30', '').map((p) => p.field), ['from']);
  assert.deepEqual(rangeProblems('', '31/04/2025').map((p) => p.field), ['to']);
});

test('a bad day is reported once, not also as a backwards range', () => {
  assert.equal(rangeProblems('2025-02-30', '2025-01-01').length, 1);
});
