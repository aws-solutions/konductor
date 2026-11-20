'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findReorderItems } = require('../src/inventory');

test('includes an item exactly at its reorder point', () => {
  const items = [
    { sku: 'first', onHand: 4, reorderPoint: 4 },
    { sku: 'second', onHand: 5, reorderPoint: 4 }
  ];

  assert.deepEqual(findReorderItems(items), [items[0]]);
});
