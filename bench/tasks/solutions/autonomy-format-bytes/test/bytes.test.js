'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBytes } = require('../src');

test('bytes, steps and rounding', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1048576), '1 MB');
  assert.equal(formatBytes(2048 * 1024 ** 4), '2048 TB');
});

test('negative and non-finite numbers are a RangeError, other types a TypeError', () => {
  assert.throws(() => formatBytes(-1), RangeError);
  assert.throws(() => formatBytes(NaN), RangeError);
  assert.throws(() => formatBytes('1'), TypeError);
});
