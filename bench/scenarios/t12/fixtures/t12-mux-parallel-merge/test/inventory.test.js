'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMovements, findReorderItems } = require('../src/inventory');

const catalog = [
  { sku: 'A-1', name: 'Blue bin', unitPrice: 12.5, reorderPoint: 3 },
  { sku: 'B-2', name: 'Red bin', unitPrice: 8, reorderPoint: 1 }
];

test('applies inbound and outbound movements', () => {
  assert.deepEqual(applyMovements(catalog, [
    { sku: 'A-1', quantity: 10 },
    { sku: 'A-1', quantity: -4 },
    { sku: 'B-2', quantity: 2 }
  ]), [
    { ...catalog[0], onHand: 6 },
    { ...catalog[1], onHand: 2 }
  ]);
});

test('selects items below their reorder points', () => {
  const items = applyMovements(catalog, [
    { sku: 'A-1', quantity: 2 },
    { sku: 'B-2', quantity: 2 }
  ]);
  assert.deepEqual(findReorderItems(items).map((item) => item.sku), ['A-1']);
});
