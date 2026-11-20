'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder, loadConfig } = require('../src');

test('combines an offer with the non-delivery Harbor rate', () => {
  assert.deepEqual(calculateOrder({
    lines: [{ sku: 'lamp', quantity: 10, unitPrice: 10 }],
    promoCode: 'WELCOME10',
    region: 'harbor'
  }), { subtotal: 100, discount: 10, shipping: 4.99, tax: 7.43, total: 102.42 });
});

test('does not unlock BASKET5 below its threshold', () => {
  assert.equal(calculateOrder({
    lines: [{ sku: 'lamp', quantity: 1, unitPrice: 24.99 }],
    promoCode: 'BASKET5', region: 'meadow'
  }).discount, 0);
});

test('unlocks BASKET5 at its threshold', () => {
  assert.equal(calculateOrder({
    lines: [{ sku: 'lamp', quantity: 1, unitPrice: 25 }],
    promoCode: 'BASKET5', region: 'meadow'
  }).discount, 5);
});

test('retains the fractional basket before currency conversion', () => {
  const result = calculateOrder({
    lines: [{ sku: 'one', quantity: 1, unitPrice: 0.105 }, { sku: 'two', quantity: 1, unitPrice: 0.105 }],
    region: 'meadow'
  });
  assert.equal(result.subtotal, 0.21);
});

test('exposes both additions in the checked-in configuration', () => {
  const config = loadConfig();
  assert.ok(config.promos && config.regions);
});
