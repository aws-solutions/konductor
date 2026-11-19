const test = require('node:test');
const assert = require('node:assert/strict');
const { createMetrics } = require('../src/metrics');

test('metrics can increment named counters', () => {
  const metrics = createMetrics();
  metrics.increment('completed');
  assert.equal(metrics.snapshot().completed, 1);
});
