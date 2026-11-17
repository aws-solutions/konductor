'use strict';

const formatCents = (cents) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** `priceLabel(sku)`: the price as shown on the page, for example "$12.50", read through the cached `lookup`. */
function createPricing(lookup) {
  async function priceLabel(sku) {
    const item = await lookup(sku);
    return item ? formatCents(item.priceCents) : null;
  }
  return { priceLabel };
}

module.exports = { createPricing, formatCents };
