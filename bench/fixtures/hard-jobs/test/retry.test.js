'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry } = require('../src/retry');

test('returns the value of the first success', async () => {
  const r = await withRetry(async () => 7, { maxRetries: 2, delayMs: 1, sleep: async () => {} });
  assert.deepEqual(r, { ok: true, value: 7, attempts: 1 });
});

test('waits with doubling delays between attempts', async () => {
  const delays = [];
  let n = 0;
  const r = await withRetry(async () => { n += 1; if (n < 3) throw new Error('x'); return n; }, { maxRetries: 4, delayMs: 100, sleep: async (ms) => { delays.push(ms); } });
  assert.equal(r.ok, true);
  assert.deepEqual(delays, [100, 200]);
});

test('gives up with the last error', async () => {
  const r = await withRetry(async () => { throw new Error('boom'); }, { maxRetries: 1, delayMs: 1, sleep: async () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.error.message, 'boom');
});
