'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorker, createQueue } = require('../src');

test('a started worker hands each job to the handler', async () => {
  const queue = createQueue();
  const seen = [];
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const worker = createWorker({ queue, handler: async (job) => { seen.push(job.id); if (seen.length === 2) done(); }, env: { WORKER_API_KEY: 'test-key' }, log: () => {} });
  worker.start();
  queue.push({ id: 'j1' });
  queue.push({ id: 'j2' });
  await finished;
  await worker.stop();
  queue.close();
  assert.deepEqual(seen.sort(), ['j1', 'j2']);
});
