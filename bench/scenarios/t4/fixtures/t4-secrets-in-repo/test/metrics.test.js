const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../src/metrics');

test('metrics can be incremented and reset', () => {
  metrics.reset();
  metrics.increment('sent');
  assert.deepEqual(metrics.snapshot(), { sent: 1 });
  metrics.reset();
});
