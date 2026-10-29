'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { windowStart, windowEnd, secondsUntil } = require('../src');

test('minute windows align to the minute', () => {
  const ts = Date.UTC(2025, 0, 15, 10, 30, 45, 500);
  assert.equal(windowStart(ts, 'minute'), Date.UTC(2025, 0, 15, 10, 30));
  assert.equal(windowEnd(ts, 'minute'), Date.UTC(2025, 0, 15, 10, 31));
});

test('secondsUntil rounds up and is at least 1', () => {
  assert.equal(secondsUntil(0, 1500), 2);
  assert.equal(secondsUntil(0, 0), 1);
});

test('unknown unit throws', () => {
  assert.throws(() => windowStart(0, 'week'), RangeError);
});
