'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGateway, manualClock } = require('../src');
const { createRateLimiter } = require('../src/ratelimit');

test('the limiter allows the limit and refuses the next request until the window ends', () => {
  const clock = manualClock(0);
  const limiter = createRateLimiter({ clock, limit: 2, windowMs: 1000 });
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, true);
  assert.deepEqual(limiter.check('k'), { allowed: false, retryAfterSec: 1 });
  clock.advance(1000);
  assert.equal(limiter.check('k').allowed, true);
});

test('the gateway refuses the 101st request of a user with 429', () => {
  const g = createGateway({ handlers: { 'GET /a': () => ({}) }, clock: manualClock(0) });
  for (let i = 0; i < 100; i++) assert.equal(g.handle({ method: 'GET', path: '/a', user: 'ana' }).status, 200);
  assert.equal(g.handle({ method: 'GET', path: '/a', user: 'ana' }).status, 429);
});
