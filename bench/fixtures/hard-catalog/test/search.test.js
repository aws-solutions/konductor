'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogService } = require('../src');

const ITEMS = [
  { ITM_NO: 'A', DESC_TXT: 'Lamp', PRC_CENTS: '000100', STAT: 'A', CAT_CD: 'lighting' },
  { ITM_NO: 'B', DESC_TXT: 'Chair', PRC_CENTS: '000200', STAT: 'A', CAT_CD: 'seating' },
  { ITM_NO: 'C', DESC_TXT: 'Bulb', PRC_CENTS: '000050', STAT: 'D', CAT_CD: 'lighting' },
];

test('listByCategory returns the items of one category in snapshot order', () => {
  const catalog = createCatalogService({ supplier: { fetchItem: async () => null }, items: ITEMS });
  assert.deepEqual(catalog.listByCategory('lighting').map((i) => i.sku), ['A', 'C']);
  assert.deepEqual(catalog.listByCategory('none'), []);
});
