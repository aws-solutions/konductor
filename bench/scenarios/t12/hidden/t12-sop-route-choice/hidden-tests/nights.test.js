'use strict';

// BK-215: nights between the check-in and check-out calendar dates (UTC); same date is 0; other fields unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summary } = require('../src/summary.js');

const b = (start, end) => ({ room: 'Birch', guest: 'A. Osei', start, end, paid: 180 });

test('BK-215 nights', () => {
  assert.equal(summary(b('2026-05-10T14:00:00Z', '2026-05-12T10:00:00Z')).nights, 2);
  assert.equal(summary(b('2026-05-01T15:00:00Z', '2026-05-04T10:00:00Z')).nights, 3);
  assert.equal(summary(b('2026-05-30T23:30:00Z', '2026-06-02T00:15:00Z')).nights, 3);
  assert.equal(summary(b('2026-05-10T09:00:00Z', '2026-05-10T17:00:00Z')).nights, 0);
  assert.equal(summary(b('2026-12-31T16:00:00Z', '2027-01-01T09:00:00Z')).nights, 1);
  const s = summary({ ...b('2026-05-10T14:00:00Z', '2026-05-12T10:00:00Z'), guests: 2 });
  assert.deepEqual(s, { room: 'Birch', guest: 'A. Osei', from: '2026-05-10T14:00:00Z', to: '2026-05-12T10:00:00Z', guests: 2, nights: 2 });
});
