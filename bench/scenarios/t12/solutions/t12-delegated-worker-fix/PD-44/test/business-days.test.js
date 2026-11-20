'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deliveryDate } = require('../src/eta.js');

test('PD-44: weekends are skipped', () => {
  assert.equal(deliveryDate('2026-03-06', 'standard'), '2026-03-11');
});

test('PD-44: holidays are skipped, a weekend holiday adds nothing', () => {
  assert.equal(deliveryDate('2026-04-02', 'express'), '2026-04-07');
  assert.equal(deliveryDate('2026-12-24', 'express'), '2026-12-29');
});
