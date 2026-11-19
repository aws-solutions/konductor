import test from 'node:test';
import assert from 'node:assert/strict';
import { captureOrder } from '../src/orders/capture.js';
import { orderStore } from './helpers.js';

test('capture records a captured order', () => {
  const store = orderStore({ status: 'authorized', capturedMinor: 0 });
  const result = captureOrder({ store, merchantId: 'm_green', orderId: 'ord_test', amountMinor: 2500 });
  assert.equal(result.status, 'captured');
  assert.equal(store.entries[0].type, 'capture');
});

test('capture rejects a different merchant', () => {
  const store = orderStore({ status: 'authorized', capturedMinor: 0 });
  assert.throws(() => captureOrder({ store, merchantId: 'm_blue', orderId: 'ord_test', amountMinor: 2500 }), /another merchant/);
});
