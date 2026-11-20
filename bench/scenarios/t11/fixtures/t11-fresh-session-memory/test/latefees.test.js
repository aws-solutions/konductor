'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lateFeeCents } = require('../src/latefees.js');

const inv = (o) => ({ id: 'INV-1', customer: 'Test', amountCents: 100000, issuedOn: '2026-10-01', dueOn: '2026-11-02', paidOn: null, ...o });

test('no fee on or before the due date', () => {
  assert.equal(lateFeeCents(inv(), '2026-11-02'), 0);
  assert.equal(lateFeeCents(inv(), '2026-10-30'), 0);
});

test('0.1% per day late, rounded down', () => {
  assert.equal(lateFeeCents(inv(), '2026-11-04'), 200);
  assert.equal(lateFeeCents(inv({ amountCents: 1999 }), '2026-11-03'), 1);
});

test('the fee is capped at 10% of the amount', () => {
  assert.equal(lateFeeCents(inv(), '2027-06-01'), 10000);
});

test('a paid invoice stops accruing on the day it was paid', () => {
  assert.equal(lateFeeCents(inv({ paidOn: '2026-11-03' }), '2026-11-20'), 100);
  assert.equal(lateFeeCents(inv({ paidOn: '2026-11-01' }), '2026-11-20'), 0);
});
