'use strict';

// The merged result: both fixes work together through quote(), with the ship date as a string or a Date
// (CONTRIBUTING.md), and parseWeight still returns a number the price bands accept.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quote } = require('../src/index.js');

test('merged: both fixes work together in quote()', () => {
  assert.deepEqual(quote({ weight: '10 LB', shipDate: '2026-04-02', service: 'express' }), {
    kg: 4.536, price: 16.4, eta: '2026-04-07', label: 'PARCEL 4.536 kg | express | due 2026-04-07',
  });
  assert.deepEqual(quote({ weight: '3 lb', shipDate: new Date('2026-12-24T20:00:00Z'), service: 'express' }), {
    kg: 1.361, price: 12.9, eta: '2026-12-29', label: 'PARCEL 1.361 kg | express | due 2026-12-29',
  });
  assert.equal(quote({ weight: '2 KG', shipDate: '2026-03-06', service: 'standard' }).eta, '2026-03-11');
});
