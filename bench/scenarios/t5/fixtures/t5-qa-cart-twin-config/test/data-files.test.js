'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rates = require('../data/tax-rates.json');

test('stores tax rates in basis points', () => {
  assert.equal(rates.default.rateBps, 825);
  assert.equal(rates.reduced.rateBps, 500);
});
