'use strict';

// Session 1's change: late fees count business days (weekdays not in config/holidays.json) after the due date.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const fee = (o, asOf) => require(path.join(ROOT, 'src', 'latefees.js')).lateFeeCents({ id: 'INV-9', customer: 'Test', issuedOn: '2026-05-01', paidOn: null, ...o }, asOf);

test('weekends and office holidays after the due date do not count', () => {
  assert.equal(fee({ amountCents: 200000, dueOn: '2026-11-06' }, '2026-11-09'), 200);
  assert.equal(fee({ amountCents: 100000, dueOn: '2026-11-25' }, '2026-11-30'), 100);
  assert.equal(fee({ amountCents: 100000, dueOn: '2026-11-10' }, '2026-11-12'), 100);
});

test('0.1% per business day rounded down, the 10% cap, and no fee until the day after the due date', () => {
  assert.equal(fee({ amountCents: 100000, dueOn: '2026-11-13' }, '2026-11-20'), 500);
  assert.equal(fee({ amountCents: 1999, dueOn: '2026-11-13' }, '2026-11-16'), 1);
  assert.equal(fee({ amountCents: 10000, dueOn: '2026-06-01' }, '2026-11-30'), 1000);
  assert.equal(fee({ amountCents: 100000, dueOn: '2026-11-20' }, '2026-11-20'), 0);
  assert.equal(fee({ amountCents: 100000, dueOn: '2026-11-20' }, '2026-11-18'), 0);
});

test('a paid invoice stops on its payment day, counting business days only', () => {
  assert.equal(fee({ amountCents: 100000, dueOn: '2026-11-06', paidOn: '2026-11-11' }, '2026-11-30'), 200);
});

test('tally fees reports the business-day fees', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-fees-'));
  try {
    const file = path.join(dir, 'invoices.json');
    fs.writeFileSync(file, JSON.stringify({ invoices: [
      { id: 'INV-7002', customer: 'Kestrel-Print', amountCents: 50000, issuedOn: '2026-10-25', dueOn: '2026-11-25', paidOn: null },
      { id: 'INV-7001', customer: 'Lumen-Yoga', amountCents: 200000, issuedOn: '2026-10-06', dueOn: '2026-11-06', paidOn: null },
    ] }));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'tally.js'), 'fees', '--date', '2026-11-30', '--file', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    // INV-7001: 13 business days (weekends and Nov 11, 26 and 27 closed) -> 2600; INV-7002: one business day (Nov 30) -> 50.
    assert.equal(r.stdout, 'INV-7001 Lumen-Yoga 2600\nINV-7002 Kestrel-Print 50\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
