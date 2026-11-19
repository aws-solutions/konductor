'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPlan } = require('../src/plans');
const { calculateProration } = require('../src/proration');

test('preview amount follows the billing cycle calculation', () => {
  const oldPlan = getPlan('starter');
  const newPlan = getPlan('growth');
  const cycleStart = '2025-05-01';
  const changeDate = '2025-05-11';
  const result = calculateProration({ oldPlan, newPlan, cycleStart, changeDate });
  const totalDays = 31;
  const daysRemaining = 21;
  const expected = Math.round(((newPlan.monthlyCents - oldPlan.monthlyCents) * daysRemaining) / totalDays);
  assert.equal(result.amountCents, expected);
});
