'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCoupon, validateCoupon } = require('../src/coupons');

test('finds an active catalog coupon', () => {
  const coupon = getCoupon('SAVE10', 1700000000000);
  assert.equal(coupon.kind, 'percent');
  assert.equal(coupon.value, 10);
  assert.equal(coupon.active, true);
});

test('accepts a coupon without an expiry', () => {
  assert.equal(validateCoupon({ code: 'FOREVER', active: true, expiresAtMs: null }, 999).code, 'FOREVER');
});
