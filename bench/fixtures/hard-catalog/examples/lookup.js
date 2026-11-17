'use strict';

const { createCatalogService } = require('../src');

const RECORDS = { 'SKU-1': { ITM_NO: 'SKU-1', DESC_TXT: 'Desk lamp', PRC_CENTS: '001250', STAT: 'A', CAT_CD: 'lighting' } };
const supplier = { fetchItem: async (sku) => RECORDS[sku] };

async function main() {
  const catalog = createCatalogService({ supplier, items: Object.values(RECORDS) });
  console.log(await catalog.lookup('SKU-1'));
  console.log(await catalog.priceLabel('SKU-1'));
  console.log(catalog.listByCategory('lighting'));
}

main();
