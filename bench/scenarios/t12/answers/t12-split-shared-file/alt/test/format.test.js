'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney, formatDate } = require('../src/format.js');

test('formatMoney: symbol, thousands and sign', () => {
  assert.equal(formatMoney(123456, 'EUR'), '€1,234.56');
  assert.equal(formatMoney(-1250, 'GBP'), '-£12.50');
  assert.equal(formatMoney(5), '$0.05');
});

test('formatDate: ISO text', () => {
  assert.equal(formatDate('2026-03-02'), '2026-03-02');
  assert.throws(() => formatDate('2/3/2026'), RangeError);
});

test('FMT-7: accounting brackets for negatives in every currency', () => {
  for (const [cur, sym] of [['USD', '$'], ['EUR', '€'], ['GBP', '£']]) {
    assert.equal(formatMoney(-123456, cur, { accounting: true }), `(${sym}1,234.56)`);
    assert.equal(formatMoney(0, cur, { accounting: true }), `${sym}0.00`);
    assert.equal(formatMoney(99, cur, { accounting: true }), `${sym}0.99`);
  }
});

test('FMT-9: long dates and a bad style', () => {
  assert.equal(formatDate('2026-03-02', 'long'), '2 March 2026');
  assert.equal(formatDate('2026-12-31', 'long'), '31 December 2026');
  assert.equal(formatDate('2026-03-02', 'iso'), '2026-03-02');
  assert.throws(() => formatDate('2026-03-02', 'short'), RangeError);
});
