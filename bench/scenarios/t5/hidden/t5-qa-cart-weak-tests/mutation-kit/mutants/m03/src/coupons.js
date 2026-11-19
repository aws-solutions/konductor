'use strict';

const { CouponError } = require('./errors');
const catalog = require('../data/coupons.json');

function findCoupon(code, coupons = catalog) {
  const coupon = coupons.find((entry) => entry.code === code);
  if (!coupon) throw new CouponError('Unknown coupon');
  return { ...coupon };
}

function validateCoupon(coupon, atMs = Date.now()) {
  if (!coupon || typeof coupon.code !== 'string') throw new CouponError('Coupon is required');
  if (coupon.expiresAtMs !== null && atMs >= coupon.expiresAtMs) {
    throw new CouponError('Coupon has expired');
  }
  if (coupon.active === false) throw new CouponError('Coupon is inactive');
  return { ...coupon };
}

function getCoupon(code, atMs = Date.now(), coupons = catalog) {
  return validateCoupon(findCoupon(code, coupons), atMs);
}

module.exports = { findCoupon, validateCoupon, getCoupon };
