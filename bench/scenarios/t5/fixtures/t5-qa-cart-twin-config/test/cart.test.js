'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCart, addItem, removeItem } = require('../src/cart');

test('creates and updates a cart with ordinary quantities', () => {
  let cart = createCart('cart-1');
  cart = addItem(cart, { sku: 'mug', unitPriceCents: 1200, quantity: 2 });
  cart = addItem(cart, { sku: 'tea', unitPriceCents: 800, quantity: 1 });
  cart = addItem(cart, { sku: 'mug', unitPriceCents: 1200, quantity: 1 });
  assert.equal(cart.lines.length, 2);
  assert.deepEqual(cart.lines[0], { sku: 'mug', unitPriceCents: 1200, quantity: 3 });
  assert.deepEqual(removeItem(cart, 'tea').lines, [{ sku: 'mug', unitPriceCents: 1200, quantity: 3 }]);
});

test('keeps an unknown removal harmless', () => {
  const cart = createCart('cart-2');
  assert.deepEqual(removeItem(cart, 'missing'), cart);
});
