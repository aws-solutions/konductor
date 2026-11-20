'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findReorderItems } = require('../src/inventory');

test('findReorderItems includes thresholds, keeps order, and rejects non-arrays', () => {
  const items = [
    { sku: 'above', onHand: 6, reorderPoint: 5 },
    { sku: 'equal', onHand: 5, reorderPoint: 5 },
    { sku: 'below', onHand: 2, reorderPoint: 5 },
    { sku: 'zero', onHand: 0, reorderPoint: 0 },
    { sku: 'later', onHand: 1, reorderPoint: 1 },
    { sku: 'safe', onHand: 8, reorderPoint: 1 }
  ];

  const selected = findReorderItems(items);
  assert.deepEqual(selected.map((item) => item.sku), ['equal', 'below', 'zero', 'later']);
  assert.strictEqual(selected[0], items[1]);
  assert.strictEqual(selected[3], items[4]);
  assert.throws(() => findReorderItems(null), {
    name: 'TypeError',
    message: 'Items must be an array'
  });
});
