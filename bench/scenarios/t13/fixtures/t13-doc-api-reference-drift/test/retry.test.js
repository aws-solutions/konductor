'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, enqueue, drain, onFailure } = require('../src');

test('retries a failed job until it succeeds', async () => {
  const queue = createQueue({ baseDelayMs: 0, jitter: false });
  let attempts = 0;
  const result = await enqueue(queue, () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary');
    return 'ok';
  });
  await drain(queue);
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('reports an exhausted job and continues draining', async () => {
  const queue = createQueue({ maxAttempts: 2, baseDelayMs: 0, jitter: false });
  const failures = [];
  onFailure(queue, (error, record) => failures.push({ message: error.message, attempts: record.attempts }));
  const failed = enqueue(queue, () => { throw new Error('permanent'); });
  await assert.rejects(failed, /permanent/);
  await drain(queue);
  assert.deepEqual(failures, [{ message: 'permanent', attempts: 2 }]);
});
