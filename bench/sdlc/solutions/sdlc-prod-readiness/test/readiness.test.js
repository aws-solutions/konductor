'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorker, createQueue, ConfigError } = require('../src');

const turns = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

test('a missing key or an out-of-range setting stops the start', () => {
  assert.throws(() => createWorker({ queue: createQueue(), handler: async () => {}, env: {} }), ConfigError);
  assert.throws(() => createWorker({ queue: createQueue(), handler: async () => {}, env: { WORKER_API_KEY: 'k', WORKER_CONCURRENCY: '0' } }), /WORKER_CONCURRENCY/);
});

test('a failure is logged with the job id, counted, and the key never logged', async () => {
  const logs = [];
  const queue = createQueue();
  const w = createWorker({ queue, handler: async () => { throw new Error('502'); }, env: { WORKER_API_KEY: 'secret-k' }, log: (e) => logs.push(e) });
  w.start();
  queue.push({ id: 'a' });
  await turns();
  assert.equal(w.getMetrics().failed, 1);
  assert.equal(logs[0].jobId, 'a');
  assert.ok(!JSON.stringify(logs).includes('secret-k'));
  await w.stop();
  queue.close();
});

test('stop reports not drained when a job outlives WORKER_DRAIN_MS', async () => {
  const queue = createQueue();
  const w = createWorker({ queue, handler: () => new Promise(() => {}), env: { WORKER_API_KEY: 'k', WORKER_DRAIN_MS: '10' }, log: () => {} });
  w.start();
  queue.push({ id: 'stuck' });
  await turns();
  assert.deepEqual(await w.stop(), { drained: false });
  queue.close();
});
