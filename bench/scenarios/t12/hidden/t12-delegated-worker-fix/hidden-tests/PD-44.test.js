'use strict';

// PD-44: business days skip weekends and config/holidays.json; a weekend holiday adds nothing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deliveryDate } = require('../src/eta.js');

test('PD-44 weekends and holidays are not business days', () => {
  assert.equal(deliveryDate('2026-03-06', 'standard'), '2026-03-11');
  assert.equal(deliveryDate('2026-03-02', 'standard'), '2026-03-05');
  assert.equal(deliveryDate('2026-04-02', 'express'), '2026-04-07');
  assert.equal(deliveryDate('2026-04-01', 'standard'), '2026-04-08');
  assert.equal(deliveryDate('2026-12-24', 'express'), '2026-12-29');
  assert.equal(deliveryDate('2026-12-23', 'standard'), '2026-12-30');
  assert.equal(deliveryDate('2026-03-07', 'express'), '2026-03-09');
  assert.equal(deliveryDate(new Date('2026-03-06T18:45:00Z'), 'express'), '2026-03-09');
});
