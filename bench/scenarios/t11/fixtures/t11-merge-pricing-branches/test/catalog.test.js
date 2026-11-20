'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findItem } = require('../src/catalog');

test('finds a catalog item by sku', () => {
  assert.equal(findItem('tea-tin').name, 'Cedar tea tin');
  assert.equal(findItem('missing'), null);
});
