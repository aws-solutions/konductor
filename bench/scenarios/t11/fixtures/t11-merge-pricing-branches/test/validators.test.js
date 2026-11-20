'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertOrder } = require('../src/validators');

test('accepts zero quantity lines', () => {
  assert.doesNotThrow(() => assertOrder({ lines: [{ sku: 'x', quantity: 0, unitPrice: 2 }] }));
});
