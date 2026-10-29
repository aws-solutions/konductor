'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuotaService, manualClock } = require('../src');

test('a denied request charges nothing', () => {
  const clock = manualClock(Date.UTC(2025, 0, 1));
  const q = createQuotaService({ clock, plans: { tiny: { minute: 2, day: 3 } } });
  q.consume('k', { plan: 'tiny' });
  q.consume('k', { plan: 'tiny' });
  assert.equal(q.consume('k', { plan: 'tiny', cost: 2 }).allowed, false);
  clock.advance(60000);
  assert.equal(q.consume('k', { plan: 'tiny' }).remaining.day, 0);
});

test('plans do not leak limits into each other', () => {
  const q = createQuotaService({ clock: manualClock(0) });
  q.consume('k', { plan: 'free' });
  assert.equal(q.consume('k', { plan: 'internal' }).remaining.minute, null);
});

test('day windows follow UTC', () => {
  const clock = manualClock(Date.UTC(2025, 2, 8, 23, 59, 59, 999));
  const q = createQuotaService({ clock, plans: { p: { day: 1 } } });
  assert.equal(q.consume('k', { plan: 'p' }).allowed, true);
  clock.advance(1);
  assert.equal(q.consume('k', { plan: 'p' }).allowed, true);
});
