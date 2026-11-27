'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney, formatDate } = require('../src/format.js');

test('formatMoney: symbol, thousands and sign', () => {
  assert.equal(formatMoney(123456, 'EUR'), '€1,234.56');
  assert.equal(formatMoney(-1250, 'GBP'), '-£12.50');
});

test('formatMoney: FMT-7 accounting style', () => {
  assert.equal(formatMoney(-1250, 'EUR', { accounting: true }), '(€12.50)');
});

test('formatDate: ISO text', () => {
  assert.equal(formatDate('2026-03-02'), '2026-03-02');
});
