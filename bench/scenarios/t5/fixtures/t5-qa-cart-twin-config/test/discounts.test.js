'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDiscounts } = require('../src/discounts');

test('applies ordinary percentage discounts', () => {
  assert.deepEqual(applyDiscounts(2000, [{ kind: 'percent', value: 10 }]), { discountCents: 200, discountedSubtotalCents: 1800 });
});

test('caps a fixed discount at zero', () => {
  assert.deepEqual(applyDiscounts(500, [{ kind: 'fixed', value: 700 }]), { discountCents: 500, discountedSubtotalCents: 0 });
});
