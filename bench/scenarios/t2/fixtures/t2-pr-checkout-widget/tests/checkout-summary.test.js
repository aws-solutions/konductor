import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDisplayTotal, lineLabel } from '../src/checkout-summary.js';

test('calculateDisplayTotal sums quantities for the summary', () => {
  assert.equal(calculateDisplayTotal([
    { price: 5.99, quantity: 2 },
    { price: 12.49, quantity: 1 }
  ]), 24.47);
});

test('calculateDisplayTotal handles an empty cart', () => {
  assert.equal(calculateDisplayTotal([]), 0);
});

test('lineLabel includes a quantity', () => {
  assert.equal(lineLabel({ name: 'Oat bread', quantity: 2 }), 'Oat bread × 2');
});

test('line labels retain product names from the catalog', () => {
  assert.equal(lineLabel({ name: 'Sea salt flakes', quantity: 1 }), 'Sea salt flakes × 1');
});

test('the summary model accepts a fractional display price', () => {
  assert.equal(calculateDisplayTotal([{ price: 0.1, quantity: 3 }]), 0.30000000000000004);
});
