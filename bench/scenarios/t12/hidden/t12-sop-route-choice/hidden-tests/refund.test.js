'use strict';

// The refund tiers of docs/policy.md: 48 h or more full, 24 h or more half rounded down to the cent, else nothing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refundFor } = require('../src/refund.js');

const start = '2026-05-10T14:00:00Z';
const at = (hours) => new Date(Date.parse(start) - hours * 3600000).toISOString();

test('refund tiers', () => {
  const b = { start, paid: 180 };
  assert.equal(refundFor(b, at(30)), 90);
  assert.equal(refundFor(b, at(48)), 180);
  assert.equal(refundFor(b, at(47.99)), 90);
  assert.equal(refundFor(b, at(24)), 90);
  assert.equal(refundFor(b, at(23.5)), 0);
  assert.equal(refundFor(b, at(200)), 180);
  assert.equal(refundFor(b, at(-1)), 0);
  assert.equal(refundFor({ start, paid: 45.25 }, at(30)), 22.62);
  assert.equal(refundFor({ start, paid: 99.99 }, at(25)), 49.99);
});
