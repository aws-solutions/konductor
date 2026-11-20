'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TTLCache } = require('../src/cache/ttl-cache');

test('cache returns a stored value', () => {
  const cache = new TTLCache({ sweepIntervalMs: 0 });
  cache.set('color', 'blue');
  assert.equal(cache.get('color'), 'blue');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0 });
  cache.close();
});

test('cache reports a missing value', () => {
  const cache = new TTLCache({ sweepIntervalMs: 0 });
  assert.equal(cache.get('missing'), undefined);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 1 });
  cache.close();
});

test('cache removes an expired value when read', () => {
  let time = 1000;
  const cache = new TTLCache({ ttlMs: 50, now: () => time, sweepIntervalMs: 0 });
  cache.set('short', 1);
  time = 1050;
  assert.equal(cache.get('short'), undefined);
  assert.equal(cache.size, 0);
  cache.close();
});

test('updateProfile refreshes cache entry', () => {
  let time = 1000;
  const cache = new TTLCache({ ttlMs: 100, now: () => time, sweepIntervalMs: 0 });
  cache.set('profile:1', { id: '1', name: 'Old' });
  time = 1050;
  cache.set('profile:1', { id: '1', name: 'New' });
  assert.equal(cache.get('profile:1').name, 'New');
  cache.close();
});

