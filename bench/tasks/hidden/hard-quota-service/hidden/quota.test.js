'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuotaService, createLimiter } = require('../src');

const T0 = Date.UTC(2025, 0, 15, 10, 30, 0, 0);

function setup(start = T0, plans) {
  let now = start;
  const clock = { now: () => now };
  const q = createQuotaService({ clock, ...(plans ? { plans } : {}) });
  return {
    q,
    set: (v) => { now = v; },
    adv: (ms) => { now += ms; },
    free: (key, o = {}) => q.consume(key, { plan: 'free', ...o }),
  };
}

test('a first request on the free plan reports the remaining quota per window', () => {
  const s = setup();
  assert.deepEqual(s.free('k'), { allowed: true, remaining: { minute: 9, day: 199, month: 2999 }, limitedBy: null, retryAfterSec: null });
  assert.deepEqual(s.free('k', { cost: 3 }).remaining, { minute: 6, day: 196, month: 2996 });
});

test('plan limits match the spec table', () => {
  const s = setup();
  assert.deepEqual(s.q.consume('p', { plan: 'pro' }).remaining, { minute: 99, day: 4999, month: 99999 });
  const cfg = require('../config/plans.json');
  assert.deepEqual([cfg.free.minute, cfg.free.day, cfg.free.month], [10, 200, 3000]);
  assert.deepEqual([cfg.pro.minute, cfg.pro.day, cfg.pro.month], [100, 5000, 100000]);
});

test('the internal plan is unlimited in every window', () => {
  const s = setup();
  let last;
  for (let i = 0; i < 300; i++) last = s.q.consume('i', { plan: 'internal' });
  assert.deepEqual(last, { allowed: true, remaining: { minute: null, day: null, month: null }, limitedBy: null, retryAfterSec: null });
});

test('using one plan never changes the limits of another', () => {
  const s = setup();
  s.free('k');
  assert.deepEqual(s.q.consume('k', { plan: 'internal' }).remaining, { minute: null, day: null, month: null });
  s.q.consume('x', { plan: 'pro' });
  assert.equal(s.free('y').remaining.minute, 9);
});

test('custom plans leave omitted windows unlimited and do not leak into each other', () => {
  const s = setup(T0, { a: { minute: 1 }, b: {} });
  assert.deepEqual(s.q.consume('k', { plan: 'a' }).remaining, { minute: 0, day: null, month: null });
  assert.equal(s.q.consume('k', { plan: 'a' }).allowed, false);
  assert.deepEqual(s.q.consume('k', { plan: 'b' }).remaining, { minute: null, day: null, month: null });
});

test('the eleventh request in a minute is denied with the wait until the next minute', () => {
  const s = setup(T0 + 30250);
  for (let i = 0; i < 10; i++) assert.equal(s.free('k').allowed, true);
  const r = s.free('k');
  assert.deepEqual(r, { allowed: false, remaining: { minute: 0, day: 190, month: 2990 }, limitedBy: 'minute', retryAfterSec: 30 });
});

test('retryAfterSec is rounded up and never below 1', () => {
  const s = setup(T0 + 59001);
  for (let i = 0; i < 10; i++) s.free('k');
  assert.equal(s.free('k').retryAfterSec, 1);
  s.set(T0 + 59999);
  assert.equal(s.free('k').retryAfterSec, 1);
  s.set(T0);
  assert.equal(s.free('k').retryAfterSec, 60);
});

test('an instant exactly on a minute boundary belongs to the new window', () => {
  const s = setup(T0 + 59999);
  for (let i = 0; i < 10; i++) s.free('k');
  assert.equal(s.free('k').allowed, false);
  s.set(T0 + 60000);
  const r = s.free('k');
  assert.equal(r.allowed, true);
  assert.equal(r.remaining.minute, 9);
});

test('a denied request charges no window', () => {
  const s = setup();
  assert.equal(s.free('k', { cost: 10 }).allowed, true);
  assert.equal(s.free('k').allowed, false);
  assert.equal(s.free('k', { cost: 4 }).allowed, false);
  s.adv(60000);
  assert.deepEqual(s.free('k').remaining, { minute: 9, day: 189, month: 2989 });
});

test('a request denied by a larger window does not charge the smaller ones', () => {
  const s = setup(T0, { tiny: { minute: 5, day: 6 } });
  assert.equal(s.q.consume('k', { plan: 'tiny', cost: 5 }).allowed, true);
  s.adv(60000);
  const denied = s.q.consume('k', { plan: 'tiny', cost: 2 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.limitedBy, 'day');
  assert.deepEqual(denied.remaining, { minute: 5, day: 1, month: null });
  assert.deepEqual(s.q.consume('k', { plan: 'tiny' }).remaining, { minute: 4, day: 0, month: null });
});

test('the window with the longest wait is reported', () => {
  const s = setup(Date.UTC(2025, 5, 10, 10, 0, 0), { p: { minute: 1, day: 1 } });
  s.q.consume('k', { plan: 'p' });
  const r = s.q.consume('k', { plan: 'p' });
  assert.equal(r.limitedBy, 'day');
  assert.equal(r.retryAfterSec, 14 * 3600);
});

test('on a tie in the wait the larger window is reported', () => {
  const s = setup(Date.UTC(2025, 5, 30, 23, 59, 30), { p: { minute: 1, day: 1 }, q: { minute: 1, day: 1, month: 1 } });
  s.q.consume('k', { plan: 'p' });
  const day = s.q.consume('k', { plan: 'p' });
  assert.deepEqual([day.limitedBy, day.retryAfterSec], ['day', 30]);
  s.set(Date.UTC(2025, 0, 31, 23, 59, 30));
  s.q.consume('m', { plan: 'q' });
  const month = s.q.consume('m', { plan: 'q' });
  assert.deepEqual([month.limitedBy, month.retryAfterSec], ['month', 30]);
});

test('the month window rolls over at the end of January', () => {
  const s = setup(Date.UTC(2025, 0, 31, 23, 59, 59, 999), { m: { month: 2 } });
  assert.equal(s.q.consume('k', { plan: 'm', cost: 2 }).allowed, true);
  const denied = s.q.consume('k', { plan: 'm' });
  assert.deepEqual([denied.allowed, denied.retryAfterSec], [false, 1]);
  s.adv(1);
  assert.deepEqual(s.q.consume('k', { plan: 'm' }).remaining, { minute: null, day: null, month: 1 });
});

test('a leap February has 29 days', () => {
  const s = setup(Date.UTC(2024, 1, 10, 12, 0, 0), { m: { month: 1 } });
  s.q.consume('k', { plan: 'm' });
  assert.equal(s.q.consume('k', { plan: 'm' }).retryAfterSec, (Date.UTC(2024, 2, 1) - Date.UTC(2024, 1, 10, 12)) / 1000);
  s.set(Date.UTC(2024, 1, 29, 23, 59, 59, 999));
  assert.equal(s.q.consume('k', { plan: 'm' }).allowed, false);
  s.set(Date.UTC(2024, 2, 1));
  assert.equal(s.q.consume('k', { plan: 'm' }).allowed, true);
});

test('February in a common year ends on the 28th and March has 31 days', () => {
  const s = setup(Date.UTC(2025, 1, 28, 12, 0, 0), { m: { month: 1 } });
  s.q.consume('k', { plan: 'm' });
  assert.equal(s.q.consume('k', { plan: 'm' }).retryAfterSec, 12 * 3600);
  s.set(Date.UTC(2025, 2, 1));
  s.q.consume('k', { plan: 'm' });
  s.set(Date.UTC(2025, 2, 31, 18, 0, 0));
  assert.equal(s.q.consume('k', { plan: 'm' }).retryAfterSec, 6 * 3600);
});

test('December rolls over into January of the next year', () => {
  const s = setup(Date.UTC(2025, 11, 31, 23, 59, 59, 999), { m: { month: 1 } });
  s.q.consume('k', { plan: 'm' });
  assert.equal(s.q.consume('k', { plan: 'm' }).allowed, false);
  s.adv(1);
  assert.equal(s.q.consume('k', { plan: 'm' }).allowed, true);
});

test('the first instant of a month belongs to that month', () => {
  const s = setup(Date.UTC(2025, 2, 1), { m: { month: 1 } });
  assert.equal(s.q.consume('k', { plan: 'm' }).allowed, true);
  s.set(Date.UTC(2025, 1, 28, 23, 59, 59, 999));
  s.q.consume('j', { plan: 'm' });
  assert.equal(s.q.consume('j', { plan: 'm' }).retryAfterSec, 1);
});

test('day windows are UTC days whatever the process time zone is', () => {
  const s = setup(Date.UTC(2025, 2, 8, 23, 59, 59, 999), { d: { day: 1 } });
  assert.equal(s.q.consume('k', { plan: 'd' }).allowed, true);
  assert.equal(s.q.consume('k', { plan: 'd' }).allowed, false);
  s.adv(1);
  assert.equal(s.q.consume('k', { plan: 'd' }).allowed, true);
});

test('day length is 24 hours on the days the clocks change', () => {
  const s = setup(Date.UTC(2025, 2, 9, 12, 0, 0), { d: { day: 1 } });
  s.q.consume('k', { plan: 'd' });
  assert.equal(s.q.consume('k', { plan: 'd' }).retryAfterSec, 12 * 3600);
  s.set(Date.UTC(2025, 10, 2, 12, 0, 0));
  s.q.consume('k', { plan: 'd' });
  assert.equal(s.q.consume('k', { plan: 'd' }).retryAfterSec, 12 * 3600);
  s.set(Date.UTC(2025, 10, 2, 0, 0, 0));
  assert.equal(s.q.consume('z', { plan: 'd' }).allowed, true);
  s.set(Date.UTC(2025, 10, 1, 23, 59, 59, 999));
  s.q.consume('y', { plan: 'd' });
  assert.equal(s.q.consume('y', { plan: 'd' }).retryAfterSec, 1);
});

test('a free key stays limited by day after many minutes of steady use', () => {
  const s = setup(Date.UTC(2025, 5, 10, 10, 0, 0));
  for (let m = 0; m < 20; m++) {
    for (let i = 0; i < 10; i++) assert.equal(s.free('k').allowed, true);
    s.adv(60000);
  }
  const r = s.free('k');
  assert.deepEqual([r.allowed, r.limitedBy, r.remaining.day, r.retryAfterSec], [false, 'day', 0, (13 * 60 + 40) * 60]);
});

test('a cost above a window limit can never fit', () => {
  const s = setup();
  assert.deepEqual(s.free('k', { cost: 11 }), { allowed: false, remaining: { minute: 10, day: 200, month: 3000 }, limitedBy: 'minute', retryAfterSec: null });
  assert.equal(s.free('k').remaining.minute, 9);
});

test('a window that can never fit has the longest wait', () => {
  const s = setup(T0, { p: { minute: 2, day: 1 } });
  const a = s.q.consume('k', { plan: 'p', cost: 2 });
  assert.deepEqual([a.allowed, a.limitedBy, a.retryAfterSec], [false, 'day', null]);
  const b = s.q.consume('k', { plan: 'p', cost: 3 });
  assert.deepEqual([b.allowed, b.limitedBy, b.retryAfterSec], [false, 'day', null]);
});

test('a bad cost throws RangeError', () => {
  const s = setup();
  for (const cost of [0, -1, 1.5, '2', NaN, Infinity, null]) {
    assert.throws(() => s.free('k', { cost }), RangeError, String(cost));
  }
});

test('an unknown plan throws RangeError naming the plan', () => {
  const s = setup();
  assert.throws(() => s.q.consume('k', { plan: 'platinum' }), (e) => e instanceof RangeError && /platinum/.test(e.message));
});

test('keys must be non-empty strings', () => {
  const s = setup();
  for (const key of ['', '   ', '\t\n', 42, null, undefined, {}]) {
    assert.throws(() => s.free(key), TypeError);
  }
});

test('keys are trimmed and independent of each other', () => {
  const s = setup();
  s.free('alice', { cost: 4 });
  assert.equal(s.free('  alice\n').remaining.minute, 5);
  assert.equal(s.free('bob').remaining.minute, 9);
  assert.equal(s.free('Alice').remaining.minute, 9);
});

test('keys that differ only in Unicode normalization share counters', () => {
  const s = setup();
  s.free('caf\u00e9', { cost: 2 });
  assert.equal(s.free('cafe\u0301').remaining.minute, 7);
  assert.equal(s.free('\u65e5\u672c\u8a9e').remaining.minute, 9);
  assert.equal(s.free('\u{1F600}').remaining.minute, 9);
});

test('keys that contain separators do not collide', () => {
  const s = setup();
  s.free('a|minute|0', { cost: 5 });
  s.free('a:b', { cost: 3 });
  assert.equal(s.free('a').remaining.minute, 9);
  assert.equal(s.free('a|minute').remaining.minute, 9);
  assert.equal(s.free('a:b').remaining.minute, 6);
});

test('a repeated requestId within 600 seconds returns the first result and charges nothing', () => {
  const s = setup();
  const first = s.free('k', { requestId: 'r1', cost: 2 });
  s.adv(5000);
  assert.deepEqual(s.free('k', { requestId: 'r1', cost: 2 }), first);
  assert.deepEqual(s.free('k', { requestId: 'r1', cost: 7 }), first);
  assert.equal(s.free('k').remaining.minute, 7);
});

test('a replay returns the first result even after the windows moved on', () => {
  const s = setup();
  const first = s.free('k', { requestId: 'r1' });
  s.adv(61000);
  assert.deepEqual(s.free('k', { requestId: 'r1' }), first);
  assert.equal(s.free('k').remaining.day, 198);
});

test('a requestId is forgotten 600 seconds after the first allowed call', () => {
  const s = setup();
  s.free('k', { requestId: 'r1' });
  s.adv(599999);
  assert.equal(s.free('k', { requestId: 'r1' }).remaining.day, 199);
  s.set(T0 + 600000);
  const again = s.free('k', { requestId: 'r1' });
  assert.equal(again.remaining.day, 198);
});

test('the 600 seconds count from the first call, not from the last replay', () => {
  const s = setup();
  s.free('k', { requestId: 'r1' });
  s.adv(300000);
  s.free('k', { requestId: 'r1' });
  s.adv(300000);
  assert.equal(s.free('k', { requestId: 'r1' }).remaining.day, 198);
});

test('a requestId belongs to its key', () => {
  const s = setup();
  s.free('a', { requestId: 'r1' });
  assert.equal(s.free('b', { requestId: 'r1' }).remaining.minute, 9);
  s.free('x:y', { requestId: 'z' });
  assert.equal(s.free('x', { requestId: 'y:z' }).remaining.minute, 9);
});

test('a denied result is not remembered', () => {
  const s = setup();
  for (let i = 0; i < 10; i++) s.free('k');
  assert.equal(s.free('k', { requestId: 'late' }).allowed, false);
  s.adv(60000);
  const r = s.free('k', { requestId: 'late' });
  assert.equal(r.allowed, true);
  assert.equal(r.remaining.minute, 9);
});

test('the system clock is used when none is given', () => {
  const q = createQuotaService();
  const r = q.consume('k', { plan: 'free' });
  assert.equal(r.allowed, true);
  assert.equal(r.remaining.minute, 9);
});

test('the legacy limiter behaves as before', () => {
  let now = 60000;
  const l = createLimiter({ limit: 1, clock: { now: () => now } });
  assert.deepEqual(l.check('a'), { allowed: true, remaining: 0, resetAt: 120000 });
  assert.deepEqual(l.check('a'), { allowed: false, remaining: 0, resetAt: 120000 });
  assert.equal(l.check('').allowed, true);
  now = 120000;
  assert.equal(l.check('a').allowed, true);
});
