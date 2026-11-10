'use strict';

const test = require('node:test');
const assert = require('node:assert');
const repo = require('../src/repository/itemRepo');

test('get returns a copy of a stored item', async () => {
  const item = await repo.get('2');
  assert.strictEqual(item.name, 'Gadget');
});

test('get returns null for a missing item', async () => {
  assert.strictEqual(await repo.get('nope'), null);
});

test('save inserts a new item', async () => {
  await repo.save({ id: '99', name: 'Doohickey', qty: 1, reorderLevel: 5 });
  assert.strictEqual((await repo.get('99')).name, 'Doohickey');
});

test('searchByName finds items by part of the name', async () => {
  const found = await repo.searchByName('gad');
  assert.deepStrictEqual(found.map((r) => r.name), ['Gadget']);
});
