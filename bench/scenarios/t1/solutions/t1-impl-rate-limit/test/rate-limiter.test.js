const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../src/rate-limiter');

test('limiter returns the plan limit and decrements remaining', () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxClients: 2, defaultPlan: 'free', plans: { free: { limit: 2 } }, keyPlans: {} }, () => 10);
  assert.deepEqual(limiter.check('a'), { allowed: true, limit: 2, remaining: 1 });
  assert.deepEqual(limiter.check('a'), { allowed: true, limit: 2, remaining: 0 });
});
