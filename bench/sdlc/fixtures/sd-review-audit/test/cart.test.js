'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cartTotal, liveCoupons } = require('../src/cart');

test('the total adds tax to the discounted subtotal', () => {
  assert.equal(cartTotal([{ priceCents: 1000, qty: 2 }], { percentOff: 10 }), 1944);
});

test('a coupon with no expiry stays live', () => {
  assert.deepEqual(liveCoupons([{ code: 'A' }, { code: 'B', expiresAt: 5 }], 10).map((c) => c.code), ['A']);
});
