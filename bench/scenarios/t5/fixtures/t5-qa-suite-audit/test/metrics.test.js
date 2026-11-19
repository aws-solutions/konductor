'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMetrics } = require('../src/metrics');

test('metrics accumulate counters and snapshots', () => {
  const metrics = createMetrics();
  metrics.increment('invoice.created');
  metrics.increment('invoice.created', 2);
  metrics.increment('payment.failed');
  assert.equal(metrics.get('invoice.created'), 3);
  assert.deepEqual(metrics.snapshot(), { 'invoice.created': 3, 'payment.failed': 1 });
});
