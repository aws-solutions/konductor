'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOrderSyncWorker } = require('../src/order-sync-worker');

test('sends an order and reports success', async () => {
  const requests = [];
  const client = { request: async (request) => { requests.push(request); return { status: 201, headers: {} }; } };
  const messages = [];
  const worker = createOrderSyncWorker({ client, logger: { info: (message, fields) => messages.push({ message, fields }) } });
  const result = await worker.syncOrder({ id: 'ord-17', totalCents: 2450 });
  assert.deepEqual(result, { ok: true, orderId: 'ord-17', status: 201 });
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].body), { id: 'ord-17', totalCents: 2450 });
  assert.equal(messages[0].fields.orderId, 'ord-17');
});

test('returns a failed result for a final partner response', async () => {
  const client = { request: async () => ({ status: 503, headers: {} }) };
  const worker = createOrderSyncWorker({ client, logger: { warn() {} } });
  assert.deepEqual(await worker.syncOrder({ id: 'ord-18' }), { ok: false, orderId: 'ord-18', status: 503 });
});
