'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration } = require('../src');

test('hours, minutes and seconds with leading zero units dropped', () => {
  assert.equal(formatDuration(3723000), '1h 2m 3s');
  assert.equal(formatDuration(61000), '1m 1s');
  assert.equal(formatDuration(999), '0s');
});

test('bad input throws the documented errors', () => {
  assert.throws(() => formatDuration(-1), RangeError);
  assert.throws(() => formatDuration('5'), TypeError);
});
