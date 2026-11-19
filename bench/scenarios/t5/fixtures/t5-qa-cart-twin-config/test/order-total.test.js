'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCart, addItem } = require('../src/cart');
const { calculateOrderTotal } = require('../src/order-total');

test('calculates a normal order total', () => {
  let cart = createCart('order-1');
  cart = addItem(cart, { sku: 'mug', unitPriceCents: 1000, quantity: 2 });
  const total = calculateOrderTotal(cart, { taxRateBps: 1000, shipping: { freeShippingThresholdCents: 5000, standardShippingCents: 500 }, discounts: [] });
  assert.equal(total.subtotalCents, 2000);
  assert.equal(total.taxCents, 200);
  assert.equal(total.shippingCents, 500);
  assert.equal(total.totalCents, 2700);
});
