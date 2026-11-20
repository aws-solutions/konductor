'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder, loadConfig } = require('../src');

test('applies a percentage offer before Harbor tax', () => {
  assert.deepEqual(calculateOrder({
    lines: [{ sku: 'mug-blue', quantity: 10, unitPrice: 10 }],
    promoCode: 'WELCOME10',
    region: 'harbor'
  }), {
    subtotal: 100,
    discount: 10,
    shipping: 4.99,
    tax: 7.43,
    total: 102.42
  });
});

test('requires the basket minimum for a fixed offer', () => {
  const small = calculateOrder({
    lines: [{ sku: 'tea-tin', quantity: 1, unitPrice: 20 }],
    promoCode: 'BASKET5',
    region: 'meadow'
  });
  const large = calculateOrder({
    lines: [{ sku: 'tea-tin', quantity: 2, unitPrice: 20 }],
    promoCode: 'BASKET5',
    region: 'meadow'
  });
  assert.equal(small.discount, 0);
  assert.equal(large.discount, 5);
});

test('loads both kinds of feature data from JSON', () => {
  const config = loadConfig();
  assert.equal(config.promos.WELCOME10.kind, 'percent');
  assert.equal(config.regions.ridge.taxShipping, true);
});

test('keeps fractional cents until the completed quote', () => {
  const quote = calculateOrder({
    lines: [
      { sku: 'a', quantity: 1, unitPrice: 0.105 },
      { sku: 'b', quantity: 1, unitPrice: 0.105 }
    ],
    region: 'meadow'
  });
  assert.equal(quote.subtotal, 0.21);
  assert.equal(quote.total, 5.21);
});
