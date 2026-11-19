import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.js';

test('memory store clones seed orders', () => {
  const source = { id: 'ord_1', status: 'new' };
  const store = new MemoryStore({ orders: [source] });
  store.order('ord_1').status = 'changed';
  assert.equal(source.status, 'new');
});
