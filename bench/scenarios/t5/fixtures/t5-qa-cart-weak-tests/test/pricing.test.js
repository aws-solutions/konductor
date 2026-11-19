'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTotal, subtotal } = require('../src/pricing');

test('prices ordinary lines and subtotals', () => {
  assert.equal(lineTotal(250, 4), 1000);
  assert.equal(lineTotal(1299, 2), 2598);
  assert.equal(subtotal([{ unitPriceCents: 250, quantity: 4 }, { unitPriceCents: 1299, quantity: 2 }]), 3598);
});
