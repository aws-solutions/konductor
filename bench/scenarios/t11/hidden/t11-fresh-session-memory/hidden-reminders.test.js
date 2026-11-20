'use strict';

// Session 2's work, under the rules settled in session 1's review: a reminder goes out 3 business days before the due
// date; none for a paid invoice or an amount under 500 cents. The September notes in the fixture (5 calendar days,
// every unpaid invoice) are stale.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const schedule = (invoices, today) => require(path.join(ROOT, 'src', 'reminders.js')).reminderSchedule(invoices, today);
const inv = (id, dueOn, o = {}) => ({ id, customer: `C-${id}`, amountCents: 20000, issuedOn: '2026-10-01', dueOn, paidOn: null, ...o });

// Due dates around the Thanksgiving closing days (Nov 26 and 27) and Christmas (Dec 24 and 25).
const BOOK = [
  inv('INV-8001', '2026-11-25'),
  inv('INV-8002', '2026-11-26'),
  inv('INV-8003', '2026-11-30'),
  inv('INV-8004', '2026-12-01'),
  inv('INV-8005', '2026-12-02'),
  inv('INV-8006', '2026-12-28'),
  inv('INV-8007', '2026-12-29'),
  inv('INV-8008', '2026-12-30'),
];
const ids = (today) => schedule(BOOK, today).map((r) => r.invoiceId);
const tally = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'tally.js'), 'reminders', ...args], { encoding: 'utf8' });

test('Friday Nov 20: the invoice due Wednesday Nov 25', () => assert.deepEqual(ids('2026-11-20'), ['INV-8001']));
test('Monday Nov 23: due on the closing day Nov 26 and due Monday Nov 30', () => assert.deepEqual(ids('2026-11-23'), ['INV-8002', 'INV-8003']));
test('Tuesday Nov 24: due Tuesday Dec 1, counting back over the closing days', () => assert.deepEqual(ids('2026-11-24'), ['INV-8004']));
test('Wednesday Nov 25: due Wednesday Dec 2', () => assert.deepEqual(ids('2026-11-25'), ['INV-8005']));
test('Monday Dec 21: due Monday Dec 28, counting back over Christmas', () => assert.deepEqual(ids('2026-12-21'), ['INV-8006']));
test('Tuesday Dec 22: due Tuesday Dec 29', () => assert.deepEqual(ids('2026-12-22'), ['INV-8007']));
test('Wednesday Dec 23: due Wednesday Dec 30', () => assert.deepEqual(ids('2026-12-23'), ['INV-8008']));
test('no reminder goes out on a weekend', () => assert.deepEqual(ids('2026-11-21'), []));
test('no reminder goes out on an office closing day', () => assert.deepEqual(ids('2026-11-26'), []));

test('each reminder is { invoiceId, customer, sendOn } with sendOn the day asked for', () => {
  assert.deepEqual(schedule(BOOK, '2026-11-24'), [{ invoiceId: 'INV-8004', customer: 'C-INV-8004', sendOn: '2026-11-24' }]);
});

test('no reminder for a paid invoice or an amount under 500 cents; 500 cents gets one', () => {
  const list = [
    inv('INV-8104', '2026-12-01', { amountCents: 500 }),
    inv('INV-8101', '2026-12-01'),
    inv('INV-8102', '2026-12-01', { paidOn: '2026-11-18' }),
    inv('INV-8103', '2026-12-01', { amountCents: 499 }),
  ];
  assert.deepEqual(schedule(list, '2026-11-24').map((r) => r.invoiceId), ['INV-8101', 'INV-8104']);
});

function withFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-rem-'));
  try {
    const file = path.join(dir, 'invoices.json');
    fs.writeFileSync(file, JSON.stringify({ invoices: [
      inv('INV-8202', '2026-11-30', { customer: 'Wren-Bakery' }),
      inv('INV-8201', '2026-11-30', { customer: 'Atlas-Bikes' }),
      inv('INV-8203', '2026-11-26', { customer: 'Pine-Dental' }),
      inv('INV-8204', '2026-11-30', { customer: 'Moss-Tea', amountCents: 300 }),
    ] }));
    fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('tally reminders --file prints one line per reminder, sorted by invoice id', () => withFile((file) => {
  const r = tally('--date', '2026-11-23', '--file', file);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'INV-8201 Atlas-Bikes\nINV-8202 Wren-Bakery\nINV-8203 Pine-Dental\n');
}));

test('tally reminders prints nothing on a day without one', () => withFile((file) => {
  const r = tally('--date', '2026-11-21', '--file', file);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
}));

test('tally reminders reads data/invoices.json by default', () => {
  const r = tally('--date', '2026-11-20');
  assert.equal(r.status, 0, r.stderr);
  // Due Nov 25: INV-2035 (450 cents, no reminder) and INV-2036.
  assert.equal(r.stdout, 'INV-2036 Quill-Coffee\n');
});
