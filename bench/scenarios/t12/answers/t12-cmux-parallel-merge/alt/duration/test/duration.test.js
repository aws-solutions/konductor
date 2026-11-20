'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration } = require('../src/format.js');

for (const [minutes, text] of [[600, '10h'], [119.6, '2h'], [59.5, '1h'], [61, '1h 1m']]) {
  test(`formatDuration(${minutes}) is ${text}`, () => assert.equal(formatDuration(minutes), text));
}
