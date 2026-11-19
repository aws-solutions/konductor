'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateShipping } = require('../src/shipping');

test('charges standard shipping below the threshold', () => {
  assert.equal(calculateShipping(4200), 799);
  assert.equal(calculateShipping(4999, { standardShippingCents: 650 }), 650);
});

test('ships a large order free', () => {
  assert.equal(calculateShipping(6500), 0);
});
