'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder } = require('../src');

test('prices a standard parcel in the default Harbor region', () => {
  const quote = calculateOrder({
    lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 8.5 }]
  });
  assert.deepEqual(quote, {
    subtotal: 17,
    discount: 0,
    shipping: 4.99,
    tax: 1.4,
    total: 23.39
  });
});

test('uses express shipping and supports an empty basket', () => {
  assert.deepEqual(calculateOrder({ lines: [], shippingMethod: 'express' }), {
    subtotal: 0,
    discount: 0,
    shipping: 12.5,
    tax: 0,
    total: 12.5
  });
});

test('rejects malformed lines', () => {
  assert.throws(() => calculateOrder({ lines: [{ sku: 'bad', quantity: 1 }] }), /unitPrice/);
});
