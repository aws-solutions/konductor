import test from 'node:test';
import assert from 'node:assert/strict';
import { addLine, getCartTotal, removeLine } from '../src/cart.js';

const products = [
  { id: 'bread', priceCents: 599 },
  { id: 'salt', priceCents: 875 }
];

test('addLine combines an existing product', () => {
  assert.deepEqual(addLine([{ productId: 'bread', quantity: 1 }], 'bread', 2), [
    { productId: 'bread', quantity: 3 }
  ]);
});

test('removeLine removes only the requested product', () => {
  assert.deepEqual(removeLine([
    { productId: 'bread', quantity: 1 },
    { productId: 'salt', quantity: 2 }
  ], 'bread'), [{ productId: 'salt', quantity: 2 }]);
});

test('getCartTotal uses catalog cents', () => {
  assert.equal(getCartTotal([{ productId: 'bread', quantity: 2 }, { productId: 'salt', quantity: 1 }], products), 2073);
});
