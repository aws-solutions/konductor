'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quote, listCarriers, normalizeAddress } = require('../src');

const to = { name: 'Grace', line1: '1 Main St', city: 'Austin', zip: '78701', country: 'us' };

test('listCarriers names the three carriers', () => {
  assert.deepEqual(listCarriers(), ['standard', 'express', 'freight']);
});

test('normalizeAddress trims, uppercases and defaults the country', () => {
  assert.deepEqual(normalizeAddress({ zip: ' ab1 2cd ', name: ' X ' }), { name: 'X', line1: '', city: '', zip: 'AB12CD', country: 'US' });
});

test('a light parcel gets standard and express options, cheapest first', () => {
  const q = quote({ items: [{ weightKg: 2 }], to });
  assert.equal(q.zone, 3);
  assert.deepEqual(q.options.map((o) => o.carrier), ['standard', 'express']);
});
