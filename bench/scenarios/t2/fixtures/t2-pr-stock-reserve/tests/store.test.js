import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.js';

test('memory store returns independent stock rows', async () => {
  const store = new MemoryStore([{ warehouseId: 'north', sku: 'A', quantity: 4 }]);
  assert.equal(await store.getStock('north', 'A'), 4);
  await store.setStock('north', 'A', 8);
  assert.deepEqual(await store.listStock('north'), [{ warehouseId: 'north', sku: 'A', quantity: 8 }]);
});
