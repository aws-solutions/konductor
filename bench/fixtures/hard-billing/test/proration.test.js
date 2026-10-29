'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prorateCredit, refundFor, planChangeCharge } = require('../src');

test('credit for the unused part of a period', () => {
  assert.equal(prorateCredit({ amountCents: 3000, daysUsed: 10, daysInPeriod: 30 }), 2000);
  assert.equal(prorateCredit({ amountCents: 3000, daysUsed: 0, daysInPeriod: 30 }), 3000);
  assert.equal(prorateCredit({ amountCents: 3000, daysUsed: 30, daysInPeriod: 30 }), 0);
});

test('days used must fit the period', () => {
  assert.throws(() => prorateCredit({ amountCents: 100, daysUsed: 31, daysInPeriod: 30 }), RangeError);
});

test('a refund before the payment is a RangeError', () => {
  assert.throws(() => refundFor({ amountCents: 500, paidAt: 1000 }, 999), RangeError);
});

test('a plan change charges the new plan for the rest minus the old credit', () => {
  assert.equal(planChangeCharge({ fromCents: 900, toCents: 2900, daysUsed: 15, daysInPeriod: 30 }), 1000);
});
