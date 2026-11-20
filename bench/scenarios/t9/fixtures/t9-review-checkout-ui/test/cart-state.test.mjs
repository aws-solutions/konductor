import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, setQuantity, itemCount, removeItem } from '../src/cart/cart-state.js';

test('adding an existing sku combines quantities', () => {
  const items = [{ sku: 'a', name: 'A', price: '2.00', quantity: 1 }];
  assert.equal(addItem(items, items[0], 2)[0].quantity, 3);
});
test('quantity zero removes a line', () => assert.deepEqual(setQuantity([{ sku: 'a', quantity: 1 }], 'a', 0), []));
test('count and removal track cart lines', () => {
  const items = [{ sku: 'a', quantity: 2 }, { sku: 'b', quantity: 1 }];
  assert.equal(itemCount(items), 3);
  assert.deepEqual(removeItem(items, 'a'), [items[1]]);
});
