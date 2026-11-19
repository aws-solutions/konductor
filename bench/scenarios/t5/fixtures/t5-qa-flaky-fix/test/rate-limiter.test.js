const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../src/rate-limiter');
const { testLimiter } = require('./helpers');

test('allows up to the configured count', () => {
  const limiter = testLimiter();
  assert.equal(limiter.allow('email'), true);
  assert.equal(limiter.allow('email'), true);
  assert.equal(limiter.allow('email'), false);
});

test('tracks keys independently', () => {
  const limiter = new RateLimiter(1, 1000);
  assert.equal(limiter.allow('one', 100), true);
  assert.equal(limiter.allow('two', 100), true);
  assert.equal(limiter.size(), 2);
});

test('can reset all keys', () => {
  const limiter = new RateLimiter(1, 1000);
  limiter.allow('one', 100);
  limiter.reset();
  assert.equal(limiter.size(), 0);
  assert.equal(limiter.allow('one', 101), true);
});
