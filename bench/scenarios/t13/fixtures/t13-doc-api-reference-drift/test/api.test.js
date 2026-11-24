'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src');

test('exports the documented queue operations', () => {
  assert.deepEqual(Object.keys(api).sort(), ['createQueue', 'drain', 'enqueue', 'onFailure', 'pause', 'resume', 'retryNow'].sort());
});

test('uses the current option defaults', () => {
  const queue = api.createQueue();
  assert.deepEqual(queue.options, { maxAttempts: 5, baseDelayMs: 200, jitter: true, concurrency: 4 });
});

test('accepts an options object and resolves a job', async () => {
  const queue = api.createQueue({ baseDelayMs: 0, jitter: false });
  const result = await api.enqueue(queue, async () => 'finished');
  await api.drain(queue);
  assert.equal(result, 'finished');
});
