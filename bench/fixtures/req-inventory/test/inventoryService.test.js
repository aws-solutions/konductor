'use strict';

const test = require('node:test');
const assert = require('node:assert');
const service = require('../src/services/inventoryService');

test('createItem assigns an id and stores the item', async () => {
  const item = await service.createItem({ name: 'Sprocket', qty: 7 });
  assert.ok(item.id);
  const found = await service.getItem(item.id);
  assert.strictEqual(found.name, 'Sprocket');
});

test('getItem returns null for an unknown id', async () => {
  assert.strictEqual(await service.getItem('does-not-exist'), null);
});

test('adjustStock adds the delta to the quantity', async () => {
  const before = await service.getItem('1');
  const after = await service.adjustStock('1', 3);
  assert.strictEqual(after.qty, before.qty + 3);
});

test('reorderReport lists clearly low items and skips well-stocked ones', async () => {
  const report = await service.reorderReport();
  const ids = report.items.map((i) => i.id);
  assert.ok(ids.includes('3'));
  assert.ok(!ids.includes('1'));
});
