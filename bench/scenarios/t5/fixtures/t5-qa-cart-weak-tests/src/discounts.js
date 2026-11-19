'use strict';

const { ValidationError } = require('./errors');

function applyDiscounts(subtotalCents, discounts = []) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new ValidationError('Subtotal must be a non-negative integer');
  }
  if (!Array.isArray(discounts)) throw new ValidationError('Discounts must be an array');
  let remainingCents = subtotalCents;
  for (const discount of discounts) {
    if (!discount || typeof discount.kind !== 'string') throw new ValidationError('Discount is invalid');
    if (discount.kind === 'percent') {
      if (!Number.isInteger(discount.value) || discount.value < 0 || discount.value > 100) {
        throw new ValidationError('Percentage discount is invalid');
      }
      remainingCents -= Math.round(remainingCents * discount.value / 100);
    } else if (discount.kind === 'fixed') {
      if (!Number.isInteger(discount.value) || discount.value < 0) {
        throw new ValidationError('Fixed discount is invalid');
      }
      remainingCents = Math.max(0, remainingCents - discount.value);
    } else {
      throw new ValidationError('Unknown discount kind');
    }
  }
  return { discountCents: subtotalCents - remainingCents, discountedSubtotalCents: remainingCents };
}

module.exports = { applyDiscounts };
