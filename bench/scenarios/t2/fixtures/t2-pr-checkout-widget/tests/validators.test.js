import test from 'node:test';
import assert from 'node:assert/strict';
import { isPositiveWholeNumber, isPromoCode } from '../src/validators.js';

test('positive whole numbers reject zero and fractions', () => {
  assert.equal(isPositiveWholeNumber(2), true);
  assert.equal(isPositiveWholeNumber(0), false);
  assert.equal(isPositiveWholeNumber(1.5), false);
});

test('promo codes allow short service codes', () => {
  assert.equal(isPromoCode('SHIP-5'), true);
  assert.equal(isPromoCode('x'), false);
});
