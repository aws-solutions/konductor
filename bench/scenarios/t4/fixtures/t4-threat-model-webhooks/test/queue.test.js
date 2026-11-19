'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RetryQueue } = require('../prototype/queue');
const { nextAttempt } = require('../prototype/forwarder');

test('queue is FIFO and retry delay grows', () => {
  const queue = new RetryQueue();
  queue.enqueue({ eventId: 'evt-one' });
  queue.enqueue({ eventId: 'evt-two', attempt: 2 });
  assert.equal(queue.size, 2);
  assert.equal(queue.next().eventId, 'evt-one');
  assert.equal(queue.next().eventId, 'evt-two');
  assert.equal(queue.next(), null);
  assert.equal(nextAttempt({ attempt: 1 }, 1000).nextAt, 6000);
  assert.equal(nextAttempt({ attempt: 3 }, 1000).nextAt, 21000);
});
