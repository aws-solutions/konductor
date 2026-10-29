'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { graceDeadline, seatLimit } = require('../src');

const DAY = 24 * 60 * 60 * 1000;

test('the grace period is 5 days after the failed payment', () => {
  assert.equal(graceDeadline(1000), 1000 + 5 * DAY);
});

test('starter and enterprise seats are not in dispute', () => {
  assert.equal(seatLimit('starter'), 1);
  assert.equal(seatLimit('enterprise'), null);
});

test('an unknown plan is a RangeError', () => {
  assert.throws(() => seatLimit('gold'), RangeError);
});
