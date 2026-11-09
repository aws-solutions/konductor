'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src');

const { quote, listCarriers, normalizeAddress } = api;
const to = (zip, country) => ({ zip, country });
const opts = (order) => quote(order).options;

test('the public API is quote, listCarriers and normalizeAddress and nothing else', () => {
  assert.deepEqual(Object.keys(api).sort(), ['listCarriers', 'normalizeAddress', 'quote']);
  assert.deepEqual(listCarriers(), ['standard', 'express', 'freight']);
});

test('a light parcel in zone 3 is priced by standard and express, cheapest first', () => {
  const q = quote({ items: [{ weightKg: 2 }], to: to('78701', 'us') });
  assert.equal(q.zone, 3);
  assert.equal(q.weightKg, 2);
  assert.deepEqual(q.to, { name: '', line1: '', city: '', zip: '78701', country: 'US' });
  assert.deepEqual(q.options, [
    { carrier: 'standard', base: 6.8, fuel: 0.54, total: 7.34 },
    { carrier: 'express', base: 13.6, fuel: 1.63, total: 15.23 },
  ]);
});

test('item quantities add up and default to 1', () => {
  const q = quote({ items: [{ weightKg: 1.5, qty: 3 }, { weightKg: 0.25, qty: 2 }], to: to('10001') });
  assert.equal(q.weightKg, 5);
  assert.equal(q.zone, 1);
  assert.deepEqual(q.options, [
    { carrier: 'standard', base: 8.5, fuel: 0.68, total: 9.18 },
    { carrier: 'express', base: 16, fuel: 1.92, total: 17.92 },
  ]);
});

test('cents rounding follows the existing results for odd weights', () => {
  assert.deepEqual(opts({ items: [{ weightKg: 12.34 }], to: to('45000') }), [
    { carrier: 'standard', base: 14.72, fuel: 1.18, total: 15.9 },
    { carrier: 'express', base: 27.18, fuel: 3.26, total: 30.44 },
  ]);
  assert.deepEqual(opts({ items: [{ weightKg: 7.777 }], to: to('30301') }), [
    { carrier: 'standard', base: 10.72, fuel: 0.86, total: 11.58 },
    { carrier: 'express', base: 19.89, fuel: 2.39, total: 22.28 },
  ]);
});

test('a non-US destination gets express only, and zone 4 applies to non-digit zips', () => {
  const q = quote({ items: [{ weightKg: 19.99 }], to: to('ab1 2cd', 'gb') });
  assert.equal(q.zone, 4);
  assert.equal(q.to.zip, 'AB12CD');
  assert.deepEqual(q.options, [{ carrier: 'express', base: 39.69, fuel: 4.76, total: 44.45 }]);
});

test('freight prices are billed in 5 cent steps, rounded up', () => {
  assert.deepEqual(opts({ items: [{ weightKg: 55.5 }], to: to('90210') }), [{ carrier: 'freight', base: 71.45, fuel: 10.72, total: 82.17 }]);
  assert.deepEqual(opts({ items: [{ weightKg: 250 }], to: to('60601'), carrier: 'freight' }), [{ carrier: 'freight', base: 133.5, fuel: 20.02, total: 153.52 }]);
});

test('a carrier filter limits the answer, and the rules for availability still apply', () => {
  assert.deepEqual(opts({ items: [{ weightKg: 2 }], to: to('78701'), carrier: 'express' }), [{ carrier: 'express', base: 13.6, fuel: 1.63, total: 15.23 }]);
  assert.throws(() => quote({ items: [{ weightKg: 2 }], to: to('78701'), carrier: 'drone' }), { message: 'unknown carrier: drone' });
  assert.throws(() => quote({ items: [{ weightKg: 31 }], to: to('30301', 'CA') }), { message: 'no carrier available' });
  assert.throws(() => quote({ items: [{ weightKg: 600 }], to: to('78701') }), { message: 'no carrier available' });
});

test('bad input fails with the existing messages', () => {
  assert.throws(() => quote({ items: [], to: to('78701') }), { message: 'order has no items' });
  assert.throws(() => quote({ items: [{ weightKg: 0 }], to: to('78701') }), { message: 'order weight must be positive' });
  assert.throws(() => quote({ items: [{ weightKg: 5 }], to: { zip: '!!' } }), { message: 'invalid address: zip' });
  assert.throws(() => normalizeAddress(null), { message: 'invalid address: expected an object' });
});

test('normalizeAddress trims every field, uppercases zip and country and defaults the country', () => {
  assert.deepEqual(normalizeAddress({ name: ' Grace ', line1: ' 1 Main ', city: ' Austin ', zip: ' ab1 2cd ', country: ' gb ' }), { name: 'Grace', line1: '1 Main', city: 'Austin', zip: 'AB12CD', country: 'GB' });
  assert.equal(normalizeAddress({ zip: 78701 }).country, 'US');
});

test('every carrier exports baseRate and no longer exports calcBase (standard)', () => {
  const c = require('../src/carriers/standard');
  assert.equal(typeof c.baseRate, 'function');
  assert.equal(c.calcBase, undefined);
  assert.equal(c.baseRate(2, 3), 6.8);
});

test('every carrier exports baseRate and no longer exports calcBase (express)', () => {
  const c = require('../src/carriers/express');
  assert.equal(typeof c.baseRate, 'function');
  assert.equal(c.calcBase, undefined);
  assert.equal(c.baseRate(2, 3), 13.6);
});

test('every carrier exports baseRate and no longer exports calcBase (freight)', () => {
  const c = require('../src/carriers/freight');
  assert.equal(typeof c.baseRate, 'function');
  assert.equal(c.calcBase, undefined);
  assert.equal(c.baseRate(55.5, 3), 71.45);
});

test('src/util.js exports roundCents with the rounding the quotes use', () => {
  const { roundCents } = require('../src/util');
  assert.equal(roundCents(1.234), 1.23);
  assert.equal(roundCents(2.675), 2.68);
  assert.equal(roundCents(1.005), 1);
  assert.equal(roundCents(0.1 + 0.2), 0.3);
  assert.equal(roundCents(10), 10);
});

test('src/util.js exports normalizeZip, which trims, uppercases and drops inner spaces', () => {
  const { normalizeZip } = require('../src/util');
  assert.equal(normalizeZip(' ab1  2cd '), 'AB12CD');
  assert.equal(normalizeZip(78701), '78701');
});

test('freight keeps its own 5 cent rounding and does not use the cents helper', () => {
  assert.equal(require('../src/carriers/freight').baseRate(30.01, 1), 50.55);
});
