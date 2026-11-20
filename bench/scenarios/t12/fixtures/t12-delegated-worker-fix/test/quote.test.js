'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quote, parseWeight, deliveryDate, priceFor, labelText } = require('../src/index.js');

test('kilograms and grams', () => {
  assert.equal(parseWeight('2.5 kg'), 2.5);
  assert.equal(parseWeight('800g'), 0.8);
  assert.equal(parseWeight(' 12 kg '), 12);
});

test('readings that are not weights are refused', () => {
  assert.throws(() => parseWeight('ten kg'), /bad weight/);
  assert.throws(() => parseWeight('5 stone'), /bad weight/);
  assert.throws(() => parseWeight(''), /bad weight/);
});

test('delivery within one week', () => {
  assert.equal(deliveryDate('2026-03-02', 'standard'), '2026-03-05');
  assert.equal(deliveryDate('2026-03-03', 'express'), '2026-03-04');
  assert.throws(() => deliveryDate('2026-03-02', 'overnight'), /unknown service/);
});

test('price bands', () => {
  assert.equal(priceFor(1, 'standard'), 4.9);
  assert.equal(priceFor(1.001, 'standard'), 6.9);
  assert.equal(priceFor(4.2, 'express'), 16.4);
  assert.throws(() => priceFor(31, 'standard'), /too heavy/);
});

test('a full quote', () => {
  assert.deepEqual(quote({ weight: '2.5 kg', shipDate: '2026-03-02', service: 'standard' }), {
    kg: 2.5, price: 9.4, eta: '2026-03-05', label: 'PARCEL 2.5 kg | standard | due 2026-03-05',
  });
  assert.equal(labelText({ kg: 0.8, service: 'express', eta: '2026-03-04' }), 'PARCEL 0.8 kg | express | due 2026-03-04');
});

test('the ship date may be a Date', () => {
  assert.equal(quote({ weight: '1 kg', shipDate: new Date('2026-03-03T15:30:00Z'), service: 'express' }).eta, '2026-03-04');
});
