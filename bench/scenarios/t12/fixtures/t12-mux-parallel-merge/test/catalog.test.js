'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCatalog, getCatalogItem } = require('../src/catalog');

test('parses catalog rows into typed items', () => {
  const catalog = parseCatalog('A-1,Blue bin,12.50,3\nB-2,Red bin,8,0');
  assert.deepEqual(catalog, [
    { sku: 'A-1', name: 'Blue bin', unitPrice: 12.5, reorderPoint: 3 },
    { sku: 'B-2', name: 'Red bin', unitPrice: 8, reorderPoint: 0 }
  ]);
});

test('finds a catalog item by SKU', () => {
  const catalog = parseCatalog('A-1,Blue bin,12.50,3');
  assert.equal(getCatalogItem(catalog, 'A-1').name, 'Blue bin');
  assert.equal(getCatalogItem(catalog, 'missing'), undefined);
});
