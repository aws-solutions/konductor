import test from 'node:test';
import assert from 'node:assert/strict';
import { refundOrder } from '../src/refunds/service.js';
import { orderStore } from './helpers.js';

test('refund creates a full refund ledger entry and merchant event', async () => {
  const store = orderStore();
  const refund = await refundOrder({
    store,
    merchantId: 'm_green',
    orderId: 'ord_test',
    amount: '25.00',
    card: { fingerprint: 'fp_test_123' },
    customerEmail: 'buyer@example.invalid'
  });

  assert.equal(refund.status, 'succeeded');
  assert.equal(refund.amountMinor, 2500);
  assert.equal(store.entries[0].type, 'refund');
  assert.equal(store.entries[0].amountMinor, 2500);
  assert.equal(store.events[0].type, 'refund.created');
  assert.equal(store.events[0].payload.refundId, refund.id);
});
