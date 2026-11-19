'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TTLCache } = require('../src/cache/ttl-cache');

test('replacement refreshes expiry and weight together', () => {
  let now = 0;
  const cache = new TTLCache({ ttlMs: 10, now: () => now, sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('record', 'long');
  now = 9;
  cache.set('record', 'x');
  now = 15;
  assert.equal(cache.get('record'), 'x');
  assert.equal(cache.weight, 1);
  cache.close();
});

test('sweep removes expired values without counting reads', () => {
  let now = 0;
  const cache = new TTLCache({ ttlMs: 10, now: () => now, sweepIntervalMs: 0 });
  cache.set('record', 1);
  now = 10;
  cache.sweep();
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0 });
  assert.equal(cache.size, 0);
  cache.close();
});

test('deleting a replaced value leaves no weight behind', () => {
  const cache = new TTLCache({ sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('record', 'large');
  cache.set('record', 'x');
  cache.delete('record');
  assert.equal(cache.weight, 0);
  cache.close();
});
