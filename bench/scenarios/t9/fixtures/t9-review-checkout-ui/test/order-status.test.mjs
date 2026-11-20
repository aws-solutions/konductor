import test from 'node:test';
import assert from 'node:assert/strict';
import { watchOrder } from '../src/order/order-status.js';

test('watchOrder renders an initial status and can stop its timer', async () => {
  const seen = [];
  const stop = watchOrder('NS-1', async () => ({ state: 'packing' }), (status) => seen.push(status.state), 1000);
  await new Promise((resolve) => setTimeout(resolve, 25));
  stop();
  assert.deepEqual(seen, ['packing']);
});
