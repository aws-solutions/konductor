'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTotal } = require('../src/pricing');

test('lineTotal accepts zero quantity while retaining quantity validation', () => {
  assert.equal(lineTotal(12.5, 0), 0);
  assert.equal(lineTotal(12.5, 0, 100), 0);
  assert.equal(lineTotal(7.25, 2, 10), 13.05);

  for (const quantity of [-1, 1.5, '0', NaN, undefined, null, Infinity, {}, Symbol('quantity')]) {
    assert.throws(() => lineTotal(12.5, quantity), {
      name: 'RangeError',
      message: 'Quantity must be a non-negative integer'
    });
  }
});
