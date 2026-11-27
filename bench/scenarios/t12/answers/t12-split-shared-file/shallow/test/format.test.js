'use strict';

// Shallow fake: the tickets' tests are written, but the code under them was never changed, so they fail.
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney, formatDate } = require('../src/format.js');

test('formatMoney: symbol, thousands and sign', () => {
  assert.equal(formatMoney(123456, 'EUR'), '€1,234.56');
});

test('formatMoney: FMT-7 accounting style', () => {
  assert.equal(formatMoney(-1250, 'EUR', { accounting: true }), '(€12.50)');
});

test('formatDate: FMT-9 long style', () => {
  assert.equal(formatDate('2026-03-02', 'long'), '2 March 2026');
});
