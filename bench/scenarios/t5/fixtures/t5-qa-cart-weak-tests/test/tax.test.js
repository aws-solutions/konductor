'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTax } = require('../src/tax');

test('calculates common whole-cent tax amounts', () => {
  assert.equal(calculateTax(1000, 1000), 100);
  assert.equal(calculateTax(2500, 500), 125);
  assert.equal(calculateTax(0, 825), 0);
});
