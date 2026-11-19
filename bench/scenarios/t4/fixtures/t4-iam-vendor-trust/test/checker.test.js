'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/health');

test('health summaries count ordinary results', () => {
  assert.deepEqual(summarize([{ ok: true }, { ok: false }, { ok: true }]), {
    total: 3,
    healthy: 2,
    degraded: 1
  });
});
