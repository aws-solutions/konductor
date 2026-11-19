'use strict';

const { subtotal } = require('./pricing');
const { applyDiscounts } = require('./discounts');
const { calculateTax } = require('./tax');
const { calculateShipping } = require('./shipping');

function calculateOrderTotal(cart, options = {}) {
  const lines = cart?.lines ?? [];
  const subtotalCents = subtotal(lines);
  if (lines.length === 0) {
    return { subtotalCents: 0, discountCents: 0, discountedSubtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 };
  }
  const discount = applyDiscounts(subtotalCents, options.discounts ?? []);
  const taxableCents = subtotalCents;
  const taxCents = calculateTax(taxableCents, options.taxRateBps ?? 0);
  const shippingCents = calculateShipping(subtotalCents, options.shipping ?? {});
  return {
    subtotalCents,
    discountCents: discount.discountCents,
    discountedSubtotalCents: discount.discountedSubtotalCents,
    taxCents,
    shippingCents,
    totalCents: discount.discountedSubtotalCents + taxCents + shippingCents
  };
}

module.exports = { calculateOrderTotal };
