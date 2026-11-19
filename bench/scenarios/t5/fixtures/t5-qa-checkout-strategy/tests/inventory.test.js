const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryRepository } = require('../src/inventory/repository');
const { reserve } = require('../src/inventory/reservation');

test('reserve decrements available stock', async () => {
  const repo = new InventoryRepository({ BOOK: 3 });
  await reserve(repo, [{ sku: 'BOOK', quantity: 2 }]);
  assert.deepEqual(await repo.snapshot(), { BOOK: 1 });
});

test('reserve rejects an unavailable line', async () => {
  const repo = new InventoryRepository({ BOOK: 1 });
  await assert.rejects(() => reserve(repo, [{ sku: 'BOOK', quantity: 2 }]), { code: 'OUT_OF_STOCK' });
});
