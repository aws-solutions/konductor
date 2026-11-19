const test = require('node:test');
const assert = require('node:assert/strict');
const { RetryQueue } = require('../src/queue/retry-queue');
test('retry queue is fifo', () => {
  const queue = new RetryQueue(); queue.push('a'); queue.push('b');
  assert.equal(queue.take(), 'a'); assert.equal(queue.size, 1);
});
