'use strict';

/** `lookup(sku)`: the item from the supplier, or null when the supplier does not know the SKU. */
function createLookup(supplier) {
  return async function lookup(sku) {
    let r;
    try {
      r = await supplier.fetchItem(sku);
    } catch (err) {
      if (err.code === 'NOT_FOUND') return null;
      throw err;
    }
    return { sku: r.ITM_NO, name: r.DESC_TXT, priceCents: Number(r.PRC_CENTS), active: r.STAT === 'A', category: r.CAT_CD };
  };
}

module.exports = { createLookup };
