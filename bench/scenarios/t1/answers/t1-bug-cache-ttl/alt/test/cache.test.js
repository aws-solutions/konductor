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

test('set refreshes TTL when overwriting an entry', () => {
  let time = 1000;
  const cache = new TTLCache({ ttlMs: 100, now: () => time, sweepIntervalMs: 0 });
  cache.set('profile:1', { id: '1', name: 'Old' });
  time = 1050;
  cache.set('profile:1', { id: '1', name: 'New' });
  // Entry should not expire at the original TTL
  time = 1100;
  assert.equal(cache.get('profile:1').name, 'New');
  // But should expire after the new TTL from the update time
  time = 1151;
  assert.equal(cache.get('profile:1'), undefined);
  cache.close();
});

test('weight is correctly tracked when overwriting entries', () => {
  const cache = new TTLCache({
    maxSize: 10,
    sizeCalculation: (v) => v.size,
    sweepIntervalMs: 0
  });
  cache.set('a', { size: 5 });
  assert.equal(cache.weight, 5);
  cache.set('a', { size: 3 });
  assert.equal(cache.weight, 3);
  cache.set('a', { size: 7 });
  assert.equal(cache.weight, 7);
  cache.close();
});

test('maxSize evicts oldest entries when exceeded', () => {
  const cache = new TTLCache({
    maxSize: 5,
    sizeCalculation: (v) => v.weight,
    sweepIntervalMs: 0
  });
  cache.set('first', { weight: 2 });
  cache.set('second', { weight: 2 });
  assert.equal(cache.weight, 4);
  cache.set('third', { weight: 4 });
  // Should have evicted 'first' and 'second' to make room
  assert.equal(cache.has('first'), false);
  assert.equal(cache.has('second'), false);
  assert.equal(cache.has('third'), true);
  assert.equal(cache.weight, 4);
  cache.close();
});

test('sweep removes expired entries without affecting stats', () => {
  let time = 1000;
  const cache = new TTLCache({ ttlMs: 100, now: () => time, sweepIntervalMs: 0 });
  cache.set('expired', 1);
  time = 1050;
  cache.set('fresh', 2); // set fresh later so it has a later expiry
  time = 1101;
  cache.sweep();
  assert.equal(cache.size, 1);
  assert.equal(cache._entries.has('fresh'), true);
  // Stats should only reflect get() calls, not sweep
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0 });
  cache.close();
});

test('stats hit and miss counts match lookup traffic', () => {
  const cache = new TTLCache({ sweepIntervalMs: 0 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // hit
  cache.get('b'); // hit
  cache.get('c'); // miss
  cache.get('a'); // hit
  cache.get('d'); // miss
  assert.deepEqual(cache.stats(), { hits: 3, misses: 2 });
  cache.close();
});

