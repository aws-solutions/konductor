'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { refundFor, summary, conflicts } = require('../src/index.js');

const booking = { room: 'Birch', guest: 'A. Osei', start: '2026-05-10T14:00:00Z', end: '2026-05-12T10:00:00Z', paid: 180 };

test('cancelling well ahead refunds everything', () => {
  assert.equal(refundFor(booking, '2026-05-01T09:00:00Z'), 180);
});

test('cancelling after the start refunds nothing', () => {
  assert.equal(refundFor(booking, '2026-05-10T15:00:00Z'), 0);
});

test('summary fields', () => {
  assert.deepEqual(summary(booking), { room: 'Birch', guest: 'A. Osei', from: booking.start, to: booking.end, guests: 1, nights: 2 });
});

test('BK-215: nights count calendar dates, a day-use booking has 0', () => {
  assert.equal(summary({ ...booking, start: '2026-05-30T23:30:00Z', end: '2026-06-02T00:15:00Z' }).nights, 3);
  assert.equal(summary({ ...booking, start: '2026-05-10T09:00:00Z', end: '2026-05-10T17:00:00Z' }).nights, 0);
});

test('clashes are found in the same room only', () => {
  const list = [booking, { ...booking, room: 'Cedar' }];
  assert.equal(conflicts(list, { room: 'Birch', start: '2026-05-11T12:00:00Z', end: '2026-05-13T10:00:00Z' }).length, 1);
});

test('back-to-back bookings do not clash', () => {
  assert.deepEqual(conflicts([booking], { room: 'Birch', start: '2026-05-12T10:00:00Z', end: '2026-05-13T10:00:00Z' }), []);
});
