'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Cache } = require('../src/cache.js');
const { loadConfig } = require('../src/config.js');

test('returns a stored entry while it is fresh', () => {
  const cache = new Cache(loadConfig().cache);
  cache.set('a', 1, 0);
  assert.equal(cache.get('a', 1000), 1);
});

test('expires an entry once its ttl has passed', () => {
  const cache = new Cache(loadConfig().cache);
  cache.set('a', 1, 0);
  assert.equal(cache.get('a', 89_999), 1);
  assert.equal(cache.get('a', 90_001), undefined);
});

test('drops the oldest entry when the cache is full', () => {
  const cache = new Cache({ ttlMs: 60_000, maxEntries: 2 });
  cache.set('a', 1, 0);
  cache.set('b', 2, 0);
  cache.set('c', 3, 0);
  assert.equal(cache.has('a', 1), false);
  assert.equal(cache.has('c', 1), true);
});
