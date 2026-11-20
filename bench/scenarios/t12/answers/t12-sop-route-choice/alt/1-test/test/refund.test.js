'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refundFor } = require('../src/refund.js');

const booking = { start: '2026-06-01T12:00:00Z', paid: 99.99 };

for (const [cancelledAt, want, why] of [
  ['2026-05-30T12:00:00Z', 99.99, 'exactly 48 hours: full'],
  ['2026-05-30T13:00:00Z', 49.99, '47 hours: half, rounded down'],
  ['2026-05-31T12:00:00Z', 49.99, 'exactly 24 hours: half'],
  ['2026-05-31T12:00:01Z', 0, 'just under 24 hours: nothing'],
]) {
  test(`refund tier: ${why}`, () => assert.equal(refundFor(booking, cancelledAt), want));
}
