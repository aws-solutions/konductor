'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refundFor } = require('../src/refund.js');

const start = '2026-05-10T14:00:00Z';
const hoursBefore = (h) => new Date(Date.parse(start) - h * 3600000).toISOString();

test('refund: 30 hours before check-in is half', () => {
  assert.equal(refundFor({ start, paid: 180 }, hoursBefore(30)), 90);
});

test('refund: half is rounded down to the cent', () => {
  assert.equal(refundFor({ start, paid: 45.25 }, hoursBefore(30)), 22.62);
});

test('refund: 48 hours is still full, under 24 is nothing', () => {
  assert.equal(refundFor({ start, paid: 180 }, hoursBefore(48)), 180);
  assert.equal(refundFor({ start, paid: 180 }, hoursBefore(23)), 0);
});
