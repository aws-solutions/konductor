'use strict';

// CMX-1: round to the minute first, whole hours show hours only, the rest unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration } = require('../src/format.js');

test('CMX-1 reading times', () => {
  const cases = [[119.6, '2h'], [44.4, '44m'], [60, '1h'], [120, '2h'], [600, '10h'], [90, '1h 30m'], [45, '45m'], [0, '0m'], [59.5, '1h'], [61, '1h 1m'], [0.4, '0m']];
  for (const [minutes, want] of cases) assert.equal(formatDuration(minutes), want, `${minutes} minutes`);
});
