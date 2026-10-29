'use strict';

const test = require('node:test');
const assert = require('node:assert');
const service = require('../src/services/inventoryService');

test('reorderReport includes an item whose quantity equals its reorder level', async () => {
  const ids = (await service.reorderReport()).items.map((i) => i.id);
  assert.ok(ids.includes('2'));
});
