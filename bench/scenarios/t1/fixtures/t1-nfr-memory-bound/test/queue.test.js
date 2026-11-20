const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryQueue } = require('../src/queue');

test('queue drains in insertion order', () => {
  const queue = new DeliveryQueue();
  queue.push('a');
  queue.push('b');
  assert.deepEqual(queue.drain(), ['a', 'b']);
  assert.deepEqual(queue.drain(), []);
});
