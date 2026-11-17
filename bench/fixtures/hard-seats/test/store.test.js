'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');

test('the store returns what was set and deletes on undefined', async () => {
  const store = createStore();
  await store.set('a', 1);
  assert.equal(await store.get('a'), 1);
  await store.set('a', undefined);
  assert.equal(await store.get('a'), undefined);
});
