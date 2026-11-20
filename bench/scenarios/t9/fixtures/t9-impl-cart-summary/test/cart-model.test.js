import test from 'node:test';
import assert from 'node:assert/strict';
import { lineAmount, merchandiseSubtotal, copyCart } from '../src/cart/model.js';

test('cart model calculates line and merchandise totals', () => {
  const cart = { items: [{ id: 'x', name: 'X', quantity: 3, unitAmount: 25 }] };
  assert.equal(lineAmount(cart.items[0]), 75);
  assert.equal(merchandiseSubtotal(cart), 75);
  assert.notEqual(copyCart(cart).items, cart.items);
});
