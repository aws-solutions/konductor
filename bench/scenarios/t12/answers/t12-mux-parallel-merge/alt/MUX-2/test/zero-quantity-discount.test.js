'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTotal } = require('../src/pricing');

test('zero quantity stays zero even with a full discount', () => {
  assert.equal(lineTotal(12.5, 0, 100), 0);
  assert.throws(() => lineTotal(12.5, -2), /Quantity must be a non-negative integer/);
});
