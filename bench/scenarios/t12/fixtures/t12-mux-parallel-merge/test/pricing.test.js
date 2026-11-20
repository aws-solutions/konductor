'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTotal, stockValue } = require('../src/pricing');

test('calculates a discounted line total to cents', () => {
  assert.equal(lineTotal(12.5, 4, 10), 45);
});

test('calculates the value of several stock items', () => {
  assert.equal(stockValue([
    { unitPrice: 12.5, onHand: 2 },
    { unitPrice: 8.25, onHand: 3 }
  ]), 49.75);
});
