'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('../src');
const { monthOf } = require('../src/dates');

test('formatMoney keeps two decimals', () => {
  assert.equal(formatMoney(12050), '120.50');
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(-380), '-3.80');
});

test('monthOf reads the UTC month from an ISO timestamp', () => {
  assert.equal(monthOf('2025-01-31T23:50:00Z'), '2025-01');
});
