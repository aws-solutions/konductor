import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeliveryStore } from '../src/storage/deliveries.js';

test('delivery store copies rows', () => {
  const store = makeDeliveryStore();
  store.add({ id: 'one' });
  assert.equal(store.has('one'), true);
  assert.deepEqual(store.all(), [{ id: 'one' }]);
});
