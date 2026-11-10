'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { applyDiscount } = require('../src/discount');

test('10% off 1000 cents', () => {
  assert.strictEqual(applyDiscount(1000, 10), 900);
});

test('rounds half up: 15% off 999 cents is 849.15 -> 849', () => {
  assert.strictEqual(applyDiscount(999, 15), 849);
});

test('rounds half up: 50% off 999 cents is 499.5 -> 500', () => {
  assert.strictEqual(applyDiscount(999, 50), 500);
});

test('caps discount at 50%', () => {
  assert.strictEqual(applyDiscount(1000, 80), 500);
});
