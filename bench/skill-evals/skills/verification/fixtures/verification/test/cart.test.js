'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cart = require('../src/cart');

const items = [
  { price: 10, qty: 2 },
  { price: 2.5, qty: 3 },
];

test('subtotal sums price times qty', () => {
  assert.strictEqual(cart.subtotal(items), 27.5);
});

test('totalForUS adds 8% tax', () => {
  assert.strictEqual(cart.totalForUS(items), 29.7);
});

test('totalForUSWithDiscount applies discount before tax', () => {
  assert.strictEqual(cart.totalForUSWithDiscount(items, 7.5), 21.6);
});
