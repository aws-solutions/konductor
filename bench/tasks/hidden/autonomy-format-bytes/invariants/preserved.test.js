'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src');

test('the existing formatters give the same output', () => {
  assert.equal(lib.formatDuration(3723000), '1h 2m 3s');
  assert.equal(lib.formatDuration(61000), '1m 1s');
  assert.equal(lib.formatNumber(1234567.5), '1,234,567.5');
  assert.equal(lib.formatPercent(0.256), '25.6%');
});

test('pad is unchanged', () => {
  assert.equal(lib.pad.left('7', 3), '  7');
  assert.equal(lib.pad.right('7', 3), '7  ');
});

test('the old exports are all still there', () => {
  for (const name of ['formatDuration', 'formatNumber', 'formatPercent']) assert.equal(typeof lib[name], 'function', name);
  assert.equal(typeof lib.pad.left, 'function');
});

test('formatBytes returns a well-formed string for a spread of valid inputs', () => {
  for (let i = 0; i < 400; i++) {
    const bytes = Math.floor(1.07 ** i * 3);
    assert.match(lib.formatBytes(bytes), /^\d+(\.\d+)? (B|KB|MB|GB|TB)$/, String(bytes));
  }
});
