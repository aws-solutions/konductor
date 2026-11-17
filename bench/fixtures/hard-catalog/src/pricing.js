'use strict';

const formatCents = (cents) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** `priceLabel(sku)`: the price as shown on the page, for example "$12.50". */
function createPricing(supplier) {
  async function priceLabel(sku) {
    const r = await supplier.fetchItem(sku);
    return formatCents(parseInt(r.PRC_CENTS, 10));
  }
  return { priceLabel };
}

module.exports = { createPricing, formatCents };
