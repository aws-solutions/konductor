'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceDate } = require('../src/format-date');

// BILL-1187. Node applies a change of process.env.TZ at once, so this test picks the zone itself and fails on a
// local-time formatter even when the suite runs with TZ=UTC.
test('invoiceDate gives the UTC date in a zone east of UTC', (t) => {
  const before = process.env.TZ;
  t.after(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; });
  process.env.TZ = 'Pacific/Auckland';
  assert.equal(invoiceDate('2026-10-31T13:30:00Z'), '2026-10-31');
  assert.equal(invoiceDate('2026-11-30T13:30:00Z'), '2026-11-30');
});
