import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/app.js';

test('setStock writes and publishes after the write', async () => {
  const app = makeApp();
  const result = await app.inventory.setStock('north', 'BEANS-1KG', 21, 'req-1');
  assert.equal(result.quantity, 21);
  assert.deepEqual(app.events.all()[0].payload, { warehouseId: 'north', sku: 'BEANS-1KG', quantity: 21 });
});

test('unlisted products are not stock', async () => {
  const app = makeApp();
  assert.equal(await app.inventory.getStock('north', 'MUG-BLUE'), null);
});
