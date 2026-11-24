'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, enqueue, drain, pause, resume } = require('../src');

test('pause holds work until resume', async () => {
  const queue = createQueue({ baseDelayMs: 0, jitter: false });
  pause(queue);
  let ran = false;
  const result = enqueue(queue, () => { ran = true; return 42; });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(ran, false);
  resume(queue);
  assert.equal(await result, 42);
  await drain(queue);
});

test('per-job attempts override the queue default', async () => {
  const queue = createQueue({ maxAttempts: 5, baseDelayMs: 0, jitter: false });
  let attempts = 0;
  const failed = enqueue(queue, () => { attempts += 1; throw new Error('stop'); }, { attempts: 1 });
  await assert.rejects(failed, /stop/);
  await drain(queue);
  assert.equal(attempts, 1);
});
