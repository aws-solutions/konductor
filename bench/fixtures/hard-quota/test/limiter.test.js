'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter, manualClock } = require('../src');

test('allows up to the limit and then denies', () => {
  const clock = manualClock(60000);
  const l = createLimiter({ limit: 2, clock });
  assert.equal(l.check('a').allowed, true);
  assert.equal(l.check('a').remaining, 0);
  assert.deepEqual(l.check('a'), { allowed: false, remaining: 0, resetAt: 120000 });
});

test('a new window starts with a clean count', () => {
  const clock = manualClock(0);
  const l = createLimiter({ limit: 1, clock });
  assert.equal(l.check('a').allowed, true);
  assert.equal(l.check('a').allowed, false);
  clock.set(60000);
  assert.equal(l.check('a').allowed, true);
});

test('keys are independent and trimmed', () => {
  const l = createLimiter({ limit: 1, clock: manualClock(0) });
  assert.equal(l.check('a').allowed, true);
  assert.equal(l.check(' a ').allowed, false);
  assert.equal(l.check('b').allowed, true);
});

test('an empty key is a valid key', () => {
  const l = createLimiter({ limit: 1, clock: manualClock(0) });
  assert.equal(l.check('').allowed, true);
  assert.equal(l.check('  ').allowed, false);
});

test('a non-string key throws TypeError', () => {
  const l = createLimiter({ limit: 1, clock: manualClock(0) });
  assert.throws(() => l.check(42), TypeError);
});

test('limit must be a positive integer', () => {
  assert.throws(() => createLimiter({ limit: 0 }), RangeError);
});
