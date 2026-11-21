const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookWorker, WebhookWorker } = require('../src/webhook-worker');
const { DedupeStore } = require('../src/dedupe-store');

test('the existing DedupeStore export remains constructible', () => {
  assert.equal(typeof DedupeStore, 'function');
});

test('the worker treats normalized keys as the same delivery', async () => {
  let calls = 0;
  const worker = createWebhookWorker({ handle: async () => { calls += 1; } });
  const first = await worker.accept({ idempotencyKey: '  EVT-9 ', payload: { n: 1 } });
  const second = await worker.accept({ idempotencyKey: 'evt-9', payload: { n: 2 } });
  assert.equal(first.status, 'processed');
  assert.equal(second.status, 'duplicate');
  assert.equal(calls, 1);
});

test('worker construction keeps the named class export', () => {
  const worker = new WebhookWorker({ handle: async () => {} });
  assert.equal(typeof worker.accept, 'function');
});

test('a worker accepts a different key after capacity evicts the first', async () => {
  let calls = 0;
  const worker = createWebhookWorker({ handle: async () => { calls += 1; } });
  await worker.accept({ idempotencyKey: 'one', payload: {} });
  await worker.accept({ idempotencyKey: 'two', payload: {} });
  await worker.accept({ idempotencyKey: 'three', payload: {} });
  await worker.accept({ idempotencyKey: 'four', payload: {} });
  const result = await worker.accept({ idempotencyKey: 'one', payload: {} });
  assert.equal(result.status, 'processed');
  assert.equal(calls, 5);
});

test('an exact retry still calls the handler only once', async () => {
  let calls = 0;
  const worker = createWebhookWorker({ handle: async () => { calls += 1; } });
  await worker.accept({ idempotencyKey: 'same', payload: {} });
  const result = await worker.accept({ idempotencyKey: 'same', payload: {} });
  assert.equal(result.status, 'duplicate');
  assert.equal(calls, 1);
});
