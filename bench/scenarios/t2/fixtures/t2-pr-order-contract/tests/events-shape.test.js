import test from 'node:test';
import assert from 'node:assert/strict';
import { orderUpdated } from '../src/events/order-events.js';

test('builds the shipping update message', () => {
  const message = orderUpdated({
    id: 'ord_7', customerId: 'cus_44', status: 'packing', revision: 12,
    updatedAt: '2025-02-01T10:00:00.000Z'
  });
  assert.deepEqual(message, {
    event: 'order.updated',
    orderId: 'ord_7',
    customerId: 'cus_44',
    status: 'packing',
    sequence: 12,
    changedAt: '2025-02-01T10:00:00.000Z'
  });
});
