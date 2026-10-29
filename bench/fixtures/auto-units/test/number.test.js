'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNumber } = require('../src');

test('thousands separators and at most one decimal', () => {
  assert.equal(formatNumber(1234567.5), '1,234,567.5');
  assert.equal(formatNumber(1000), '1,000');
  assert.equal(formatNumber(12.04), '12');
});

test('non-finite input is a RangeError', () => {
  assert.throws(() => formatNumber(Infinity), RangeError);
});
