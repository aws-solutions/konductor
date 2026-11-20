// Changes for this request; see the commit message for the reasoning.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../src/rate-limiter');

test('allows up to the configured count', () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.allow('email', 100), true);
  assert.equal(limiter.allow('email', 101), true);
  assert.equal(limiter.allow('email', 102), false);
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
