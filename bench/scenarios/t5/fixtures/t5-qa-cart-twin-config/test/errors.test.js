'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCart } = require('../src/cart');

test('rejects a missing cart id', () => {
  assert.throws(() => createCart(''), /Cart id/);
});
