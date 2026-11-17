'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogService } = require('../src');

const LAMP = { ITM_NO: 'SKU-1', DESC_TXT: 'Desk lamp', PRC_CENTS: '001250', STAT: 'A', CAT_CD: 'lighting' };

test('lookup returns the item in the domain shape', async () => {
  const catalog = createCatalogService({ supplier: { fetchItem: async () => LAMP } });
  assert.deepEqual(await catalog.lookup('SKU-1'), { sku: 'SKU-1', name: 'Desk lamp', priceCents: 1250, active: true, category: 'lighting' });
});

test('lookup of an unknown SKU is null', async () => {
  const supplier = { fetchItem: async () => { throw Object.assign(new Error('no such item'), { code: 'NOT_FOUND' }); } };
  assert.equal(await createCatalogService({ supplier }).lookup('SKU-9'), null);
});
