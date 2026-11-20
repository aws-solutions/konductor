// Changes for this request; see the commit message for the reasoning.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCart, addItem } = require('../src/cart');
const { applyDiscounts } = require('../src/discounts');
const { findCoupon, validateCoupon } = require('../src/coupons');
const { calculateTax } = require('../src/tax');
const { calculateShipping } = require('../src/shipping');
const { calculateOrderTotal } = require('../src/order-total');
const { CartStore } = require('../src/store');

test('keeps discount order and rounds a percentage reduction', () => {
  assert.deepEqual(applyDiscounts(1999, [
    { kind: 'percent', value: 10 },
    { kind: 'fixed', value: 300 }
  ]), { discountCents: 500, discountedSubtotalCents: 1499 });
  assert.deepEqual(applyDiscounts(999, [{ kind: 'percent', value: 15 }]), {
    discountCents: 150,
    discountedSubtotalCents: 849
  });
});

test('enforces the quantity limit at the boundary', () => {
  let cart = addItem(createCart('limit'), { sku: 'book', unitPriceCents: 100, quantity: 99 });
  assert.equal(cart.lines[0].quantity, 99);
  assert.throws(() => addItem(cart, { sku: 'book', unitPriceCents: 100, quantity: 1 }), /Quantity/);
  assert.throws(() => addItem(createCart('too-many'), { sku: 'pen', unitPriceCents: 100, quantity: 100 }), /Quantity/);
});

test('accepts a coupon at its expiry and rejects it afterwards', () => {
  const coupon = { code: 'EDGE', active: true, expiresAtMs: 5000 };
  assert.equal(validateCoupon(coupon, 5000).code, 'EDGE');
  assert.throws(() => validateCoupon(coupon, 5001), /expired/);
});

test('rejects an unknown coupon rather than returning a partial record', () => {
  assert.throws(() => findCoupon('NOT-IN-CATALOG', [{ code: 'KNOWN' }]), /Unknown coupon/);
});

test('makes the threshold order free to ship', () => {
  assert.equal(calculateShipping(5000, { freeShippingThresholdCents: 5000, standardShippingCents: 799 }), 0);
  assert.equal(calculateShipping(4999, { freeShippingThresholdCents: 5000, standardShippingCents: 799 }), 799);
});

test('rounds tax in cents instead of dropping the fraction', () => {
  assert.equal(calculateTax(105, 825), 9);
});

test('does not charge an empty cart', () => {
  const total = calculateOrderTotal(createCart('empty'), {
    taxRateBps: 825,
    shipping: { freeShippingThresholdCents: 5000, standardShippingCents: 799 }
  });
  assert.deepEqual(total, {
    subtotalCents: 0,
    discountCents: 0,
    discountedSubtotalCents: 0,
    taxCents: 0,
    shippingCents: 0,
    totalCents: 0
  });
});

test('taxes the discounted subtotal', () => {
  const cart = addItem(createCart('discounted-tax'), { sku: 'small', unitPriceCents: 1000, quantity: 1 });
  const total = calculateOrderTotal(cart, {
    discounts: [{ kind: 'fixed', value: 101 }],
    taxRateBps: 825,
    shipping: { freeShippingThresholdCents: 10000, standardShippingCents: 0 }
  });
  assert.equal(total.subtotalCents, 1000);
  assert.equal(total.discountedSubtotalCents, 899);
  assert.equal(total.taxCents, 74);
  assert.equal(total.totalCents, 973);
});

test('clears stored state between calls while retaining the same cart id', () => {
  const store = new CartStore();
  store.addItem('persistent', { sku: 'tea', unitPriceCents: 875, quantity: 1 });
  assert.equal(store.getCart('persistent').lines.length, 1);
  store.clear('persistent');
  assert.deepEqual(store.getCart('persistent'), { id: 'persistent', lines: [] });
  store.addItem('persistent', { sku: 'mug', unitPriceCents: 1299, quantity: 1 });
  assert.equal(store.getCart('persistent').lines[0].sku, 'mug');
});
