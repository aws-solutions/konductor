'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { healthPayload } = require('../src/health');
const { withinLimit } = require('../src/limits');
const { createMetrics } = require('../src/metrics');

test('reports health and size limits', () => {
  assert.equal(healthPayload().ok, true);
  assert.equal(withinLimit(10, 20), true);
  assert.equal(withinLimit(21, 20), false);
});

test('collects simple counters', () => {
  const metrics = createMetrics();
  metrics.increment('uploads');
  metrics.increment('uploads', 2);
  assert.deepEqual(metrics.snapshot(), { uploads: 3 });
});
