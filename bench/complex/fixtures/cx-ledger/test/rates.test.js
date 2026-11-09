'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateCache } = require('../src');

test('rates are fetched once and served from the cache until they expire', async () => {
  let now = 0;
  let calls = 0;
  const cache = createRateCache({ clock: { now: () => now }, ttlMs: 1000, fetchRates: async () => { calls += 1; return { EUR: 0.9 }; } });
  assert.equal(await cache.get('EUR'), 0.9);
  now = 999;
  assert.equal(await cache.get('EUR'), 0.9);
  assert.equal(calls, 1);
  now = 1000;
  await cache.get('EUR');
  assert.equal(calls, 2);
});
