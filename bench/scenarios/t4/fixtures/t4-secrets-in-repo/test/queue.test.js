const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../src/queue');

test('queue preserves order', () => {
  queue.clear(); queue.enqueue('a'); queue.enqueue('b');
  assert.equal(queue.dequeue(), 'a');
  assert.equal(queue.size(), 1);
  queue.clear();
});
