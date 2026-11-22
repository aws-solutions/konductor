import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCategories, findProduct } from '../src/catalog.js';

const products = [
  { id: 'a', category: 'pantry' },
  { id: 'b', category: 'produce' },
  { id: 'c', category: 'pantry' }
];

test('findProduct returns the requested product', () => {
  assert.deepEqual(findProduct(products, 'b'), products[1]);
  assert.equal(findProduct(products, 'missing'), null);
});

test('availableCategories is unique and sorted', () => {
  assert.deepEqual(availableCategories(products), ['pantry', 'produce']);
});
