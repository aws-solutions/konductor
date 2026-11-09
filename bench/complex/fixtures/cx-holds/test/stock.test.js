'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStock } = require('../src');

test('quantity reports the level of a stocked sku', async () => {
  const stock = createStock({ widget: 5 });
  assert.equal(await stock.quantity('widget'), 5);
});

test('adjust changes the level and returns the new one', async () => {
  const stock = createStock({ widget: 5 });
  assert.equal(await stock.adjust('widget', -2), 3);
  assert.equal(await stock.quantity('widget'), 3);
});

test('adjust below zero fails and leaves the level alone', async () => {
  const stock = createStock({ widget: 1 });
  await assert.rejects(stock.adjust('widget', -2), { code: 'insufficient_stock' });
  assert.equal(await stock.quantity('widget'), 1);
});

test('an unknown sku fails with unknown_sku', async () => {
  const stock = createStock({});
  await assert.rejects(stock.quantity('nothing'), { code: 'unknown_sku' });
});
