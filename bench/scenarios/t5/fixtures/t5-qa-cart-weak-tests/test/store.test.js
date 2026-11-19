'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CartStore } = require('../src/store');

test('stores and removes items by cart id', () => {
  const store = new CartStore();
  store.addItem('saved', { sku: 'tea', unitPriceCents: 800, quantity: 2 });
  assert.equal(store.getCart('saved').lines[0].quantity, 2);
  store.removeItem('saved', 'tea');
  assert.equal(store.getCart('saved').lines.length, 0);
});
