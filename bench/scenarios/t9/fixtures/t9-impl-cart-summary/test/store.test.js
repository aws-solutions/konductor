import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store/memory.js';
import { createCartStore } from '../src/store/cart-store.js';

test('memory store updates without exposing state', () => {
  const store = createMemoryStore({ open: true });
  const next = store.update({ count: 2 });
  assert.deepEqual(next, { open: true, count: 2 });
  next.count = 8;
  assert.equal(store.read().count, 2);
});

test('cart store copies accepted carts', () => {
  const store = createCartStore({ items: [{ id: 'x', name: 'X', quantity: 1, unitAmount: 10 }] });
  const copy = store.get();
  copy.items[0].quantity = 9;
  assert.equal(store.get().items[0].quantity, 1);
});
