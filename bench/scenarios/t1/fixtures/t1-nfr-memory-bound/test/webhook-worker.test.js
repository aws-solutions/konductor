const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookWorker } = require('../src/webhook-worker');

 test('processes a delivery and reports its result', async () => {
  const received = [];
  const worker = createWebhookWorker({ handle: async payload => received.push(payload) });
  const result = await worker.accept({ idempotencyKey: 'a', payload: { ok: true } });
  assert.deepEqual(result, { status: 'processed', key: 'a' });
  assert.deepEqual(received, [{ ok: true }]);
});

test('does not call the handler twice for a retry', async () => {
  let calls = 0;
  const worker = createWebhookWorker({ handle: async () => { calls += 1; } });
  await worker.accept({ idempotencyKey: 'a', payload: {} });
  const result = await worker.accept({ idempotencyKey: 'a', payload: {} });
  assert.equal(result.status, 'duplicate');
  assert.equal(calls, 1);
});
