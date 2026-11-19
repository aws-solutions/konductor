import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayout } from '../src/payouts/payout-service.js';
import { orderStore } from './helpers.js';

test('payout adds an outbox job and ledger entry', () => {
  const store = orderStore();
  const payout = createPayout({ store, merchantId: 'm_green', amountMinor: 1000 });
  assert.equal(payout.status, 'queued');
  assert.equal(store.outbox.length, 1);
  assert.equal(store.entries[0].type, 'payout');
});
