'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder } = require('../src');

test('includes the default place charge in a standard quote', () => {
  assert.deepEqual(calculateOrder({
    lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 8.5 }]
  }), { subtotal: 17, discount: 0, shipping: 4.99, tax: 1.4, total: 23.39 });
});

test('keeps an empty express shipment free of tax', () => {
  assert.deepEqual(calculateOrder({ lines: [], shippingMethod: 'express' }), {
    subtotal: 0, discount: 0, shipping: 12.5, tax: 0, total: 12.5
  });
});

test('rejects a line without a price', () => {
  assert.throws(() => calculateOrder({ lines: [{ sku: 'bad', quantity: 1 }] }), /unitPrice/);
});
