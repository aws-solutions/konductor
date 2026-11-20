'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reminderSchedule, sendOnFor } = require('../src/reminders.js');
const { lateFeeCents } = require('../src/latefees.js');

const inv = (o) => ({ id: 'INV-1', customer: 'Test', amountCents: 10000, issuedOn: '2026-10-01', dueOn: '2026-11-25', paidOn: null, ...o });

test('a reminder goes out 3 business days before the due date', () => {
  assert.equal(sendOnFor('2026-11-25'), '2026-11-20');
  assert.equal(sendOnFor('2026-12-01'), '2026-11-24', 'the Thanksgiving closing days do not count');
});

test('paid invoices and amounts under 500 cents get no reminder', () => {
  const list = [inv({ id: 'A' }), inv({ id: 'B', paidOn: '2026-11-10' }), inv({ id: 'C', amountCents: 499 }), inv({ id: 'D', amountCents: 500 })];
  assert.deepEqual(reminderSchedule(list, '2026-11-20').map((r) => r.invoiceId), ['A', 'D']);
});

test('late fees count business days only', () => {
  assert.equal(lateFeeCents(inv({ amountCents: 100000, dueOn: '2026-11-06' }), '2026-11-09'), 100);
  assert.equal(lateFeeCents(inv({ amountCents: 100000, dueOn: '2026-11-25' }), '2026-11-30'), 100);
});
