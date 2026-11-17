'use strict';

// Anti-corruption layer: the only module that reads the supplier's record format (docs/SUPPLIER-API.md).

/** The domain item `{ sku, name, priceCents, active, category }` for one legacy supplier record. */
function toItem(record) {
  return {
    sku: record.ITM_NO,
    name: record.DESC_TXT,
    priceCents: parseInt(record.PRC_CENTS, 10),
    active: record.STAT === 'A',
    category: record.CAT_CD,
  };
}

/** The supplier seen through the domain: `fetchItem(sku)` resolves to a domain item. Errors pass through unchanged. */
function domainSupplier(supplier) {
  return { fetchItem: async (sku) => toItem(await supplier.fetchItem(sku)) };
}

module.exports = { toItem, domainSupplier };
