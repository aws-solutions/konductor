const test = require('node:test');
const assert = require('node:assert/strict');
const { health } = require('../src/health');
const queue = require('../src/queue');

test('health reports queue depth', () => {
  queue.clear();
  queue.enqueue({ id: 1 });
  assert.deepEqual(health(), { status: 'ok', queueDepth: 1 });
  queue.clear();
});
