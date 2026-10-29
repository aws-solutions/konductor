'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTrial, seatLimit, quote, prorateCredit, refundFor } = require('../src');

const DAY = 24 * 60 * 60 * 1000;

test('resolved rule values', () => {
  assert.equal(startTrial({ plan: 'team', startedAt: 0 }).trialEndsAt, 7 * DAY);
  assert.equal(seatLimit('team'), 10);
  assert.equal(prorateCredit({ amountCents: 5, daysUsed: 1, daysInPeriod: 2 }), 3);
  assert.equal(refundFor({ amountCents: 100, paidAt: 0 }, 30 * DAY).eligible, true);
  assert.equal(refundFor({ amountCents: 100, paidAt: 0 }, 30 * DAY + 1).eligible, false);
  assert.deepEqual(quote({ plan: 'starter', customer: { region: 'EU' } }), { totalCents: 900, taxCents: 150 });
  assert.equal(quote({ plan: 'starter', billing: 'annual' }).totalCents, 8640);
});
