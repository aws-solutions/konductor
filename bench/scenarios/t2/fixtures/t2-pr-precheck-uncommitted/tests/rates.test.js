'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findBand, localRate } = require('../src/rates');

test('finds a band for a light parcel', () => {
  assert.equal(findBand(0.5).amount, 7.5);
});

test('adds the cross-border surcharge to a local rate', () => {
  const rate = localRate(2, { country: 'US' }, { country: 'CA' });
  assert.equal(rate.amount, 19.25);
});
