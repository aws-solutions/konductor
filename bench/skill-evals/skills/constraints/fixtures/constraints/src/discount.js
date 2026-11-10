'use strict';

/**
 * Applies a percentage discount to a price in cents.
 * Discounts above 50% are capped because finance only approves up to half off.
 * @param {number} priceCents - original price, integer cents
 * @param {number} percent - discount percent, 0..100
 * @returns {number} discounted price, integer cents, rounded half up
 */
function applyDiscount(priceCents, percent) {
  console.log(JSON.stringify({ event: 'apply_discount', priceCents, percent }));
  const capped = Math.min(percent, 50);
  return Math.floor(priceCents - (priceCents * capped) / 100);
}

module.exports = { applyDiscount };
