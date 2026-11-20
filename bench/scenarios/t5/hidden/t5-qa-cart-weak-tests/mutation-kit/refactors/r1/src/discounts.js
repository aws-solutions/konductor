'use strict';

const { ValidationError } = require('./errors');

const isCount = (n) => Number.isInteger(n) && n >= 0;

// One reducer per discount kind: (remaining cents, value) -> remaining cents, after checking the value.
const KINDS = {
  percent(remaining, value) {
    if (!isCount(value) || value > 100) throw new ValidationError('Percentage discount is invalid');
    return remaining - Math.round((remaining * value) / 100);
  },
  fixed(remaining, value) {
    if (!isCount(value)) throw new ValidationError('Fixed discount is invalid');
    return Math.max(0, remaining - value);
  },
};

function applyDiscounts(subtotalCents, discounts = []) {
  if (!isCount(subtotalCents)) throw new ValidationError('Subtotal must be a non-negative integer');
  if (!Array.isArray(discounts)) throw new ValidationError('Discounts must be an array');
  const discountedSubtotalCents = discounts.reduce((remaining, discount) => {
    if (!discount || typeof discount.kind !== 'string') throw new ValidationError('Discount is invalid');
    const apply = Object.prototype.hasOwnProperty.call(KINDS, discount.kind) ? KINDS[discount.kind] : null;
    if (!apply) throw new ValidationError('Unknown discount kind');
    return apply(remaining, discount.value);
  }, subtotalCents);
  return { discountCents: subtotalCents - discountedSubtotalCents, discountedSubtotalCents };
}

module.exports = { applyDiscounts };
