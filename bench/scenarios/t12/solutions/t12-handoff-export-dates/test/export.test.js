'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { toCsv, COLUMNS } = require('../src/export');
const invoices = require('./fixtures/invoices.json');

test('header keeps the public column order', () => {
  assert.equal(toCsv([]).trim(), COLUMNS.join(','));
});

test('dates are the invoice UTC dates', () => {
  const lines = toCsv(invoices).trim().split('\n');
  assert.equal(lines[1], 'INV-3001,Harbor & Pine,2026-10-31,2026-11-30,125000,NZD');
  assert.equal(lines[2], 'INV-3002,"Moa Logistics, Ltd",2026-11-01,2026-12-01,4800,NZD');
});

// BILL-1187: the bug only shows when the server zone differs from UTC, and CI runs in UTC. This test sets the zone
// itself, so it fails on the old code whatever zone the suite runs in.
test('dates do not depend on the server time zone (BILL-1187)', () => {
  const cases = [['Pacific/Auckland', '2026-10-31T13:30:00Z', '2026-10-31'], ['America/Los_Angeles', '2026-11-01T03:00:00Z', '2026-11-01']];
  for (const [tz, iso, want] of cases) {
    const js = `process.stdout.write(require('./src/format-date').invoiceDate(${JSON.stringify(iso)}))`;
    const got = execFileSync(process.execPath, ['-e', js], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(got, want, `${iso} under TZ=${tz}`);
  }
});
