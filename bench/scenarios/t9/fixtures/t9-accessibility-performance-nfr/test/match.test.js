import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchesQuery } from '../src/match.js';

const order = {
  id: 'TW-10042',
  customer: 'Søren Lindqvist',
  city: 'Malmö',
  items: [{ name: 'Enamel camp mug' }, { name: 'Linen tea towel' }],
};

test('fold lowercases and strips accents', () => {
  assert.equal(fold('Zoë Renée'), 'zoe renee');
});

test('fold maps letters that do not decompose', () => {
  assert.equal(fold('Søren Łukasz Straße'), 'soren lukasz strasse');
});

test('an empty or blank query matches every order', () => {
  assert.equal(matchesQuery(order, ''), true);
  assert.equal(matchesQuery(order, '   '), true);
});

test('matches ignoring accents in either direction', () => {
  assert.equal(matchesQuery(order, 'soren'), true);
  assert.equal(matchesQuery(order, 'MALMÖ'), true);
  assert.equal(matchesQuery(order, 'malmo'), true);
});

test('every word must be found, in any order', () => {
  assert.equal(matchesQuery(order, 'malmo soren'), true);
  assert.equal(matchesQuery(order, 'malmo mug'), true);
  assert.equal(matchesQuery(order, 'malmo kettle'), false);
});

test('matches the order id', () => {
  assert.equal(matchesQuery(order, 'tw-10042'), true);
  assert.equal(matchesQuery(order, '10043'), false);
});
