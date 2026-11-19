'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPlan } = require('../src/plans');
const { calculateProration } = require('../src/proration');

test('plan change produces a proration record', () => {
  const result = calculateProration({ oldPlan: getPlan('starter'), newPlan: getPlan('growth'), cycleStart: '2025-01-01', changeDate: '2025-01-16' });
  assert.equal(result.amountCents, result.amountCents);
  assert.equal(result.newPlan, 'growth');
});
