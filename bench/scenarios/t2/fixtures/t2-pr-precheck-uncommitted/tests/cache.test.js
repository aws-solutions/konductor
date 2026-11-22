'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QuoteCache } = require('../src/cache');

test('expires values after the configured lifetime', () => {
  let now = 100;
  const cache = new QuoteCache(10, () => now);
  cache.set('a', { total: 4 });
  assert.deepEqual(cache.get('a'), { total: 4 });
  now = 111;
  assert.equal(cache.get('a'), undefined);
});
