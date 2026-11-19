'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../data/catalog.json');

test('catalog has active and inactive records', () => {
  assert.equal(catalog.length, 3);
  assert.equal(catalog.filter((item) => item.active).length, 2);
  assert.equal(catalog[0].unitPriceCents, 1299);
});
