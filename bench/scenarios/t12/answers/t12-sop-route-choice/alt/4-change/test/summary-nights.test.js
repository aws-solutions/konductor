'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summary } = require('../src/summary.js');

test('BK-215: nights across a month end and a year end', () => {
  assert.equal(summary({ start: '2026-01-31T18:00:00Z', end: '2026-02-02T09:00:00Z' }).nights, 2);
  assert.equal(summary({ start: '2026-12-31T18:00:00Z', end: '2027-01-01T09:00:00Z' }).nights, 1);
});

test('BK-215: day use has 0 nights', () => {
  assert.equal(summary({ start: '2026-03-03T08:00:00Z', end: '2026-03-03T20:00:00Z' }).nights, 0);
});
