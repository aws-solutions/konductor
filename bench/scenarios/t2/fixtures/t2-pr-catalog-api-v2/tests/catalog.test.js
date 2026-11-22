import test from 'node:test';
import assert from 'node:assert/strict';
import { getProduct } from '../src/catalog/product-service.js';

test('returns a known product with its details', async () => {
  const product = await getProduct('p-100');
  assert.equal(product.id, 'p-100');
  assert.equal(product.priceCents, 2400);
  assert.deepEqual(product.labels, ['camping', 'drinkware']);
  assert.equal(product.warehouseNote, '');
});

test('returns the active product status', async () => {
  const product = await getProduct('p-100');
  assert.equal(product.status, 'active');
  assert.equal(product.updatedAt, '2025-02-10T10:30:00.000Z');
});

test('returns null for an unknown product', async () => {
  assert.equal(await getProduct('p-missing'), null);
});
