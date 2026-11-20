'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration } = require('../src/format.js');

test('CMX-1: whole hours show hours only', () => {
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(120), '2h');
});

test('CMX-1: rounded to the minute before splitting', () => {
  assert.equal(formatDuration(119.6), '2h');
  assert.equal(formatDuration(44.4), '44m');
});
