'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findReorderItems } = require('../src/inventory');

test('keeps zero-stock items at the replenishment boundary', () => {
  const zeroStock = { sku: 'ZERO', onHand: 0, reorderPoint: 0 };
  const stocked = { sku: 'FULL', onHand: 3, reorderPoint: 2 };
  const boundary = { sku: 'EDGE', onHand: 10, reorderPoint: 10 };

  assert.deepEqual(findReorderItems([zeroStock, stocked, boundary]), [zeroStock, boundary]);
});
