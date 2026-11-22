import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductChanged, eventPrice } from '../src/events/product-changed.js';

test('builds the search event fields', () => {
  const event = buildProductChanged({ id: 'p-9', name: 'Cap', status: 'active', priceCents: 1250, labels: ['summer'] });
  assert.equal(event.type, 'product.changed');
  assert.equal(event.version, 1);
  assert.equal(event.product.id, 'p-9');
  assert.deepEqual(event.product.labels, ['summer']);
});

test('converts cents for display calculations', () => {
  assert.equal(eventPrice({ priceCents: 1250 }), 12.5);
});
