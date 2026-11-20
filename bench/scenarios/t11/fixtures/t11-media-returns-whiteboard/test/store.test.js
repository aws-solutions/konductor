'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../src/returns/store');
test('memory store copies records at its boundary', () => {
  const store = createMemoryStore();
  const value = store.put({ id: 'r-2', state: 'NEW' });
  value.state = 'changed locally';
  assert.equal(store.get('r-2').state, 'NEW');
});
