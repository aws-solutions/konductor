'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertOrder } = require('../src/validators');

test('rejects a zero quantity', () => {
  assert.throws(() => assertOrder({ lines: [{ sku: 'x', quantity: 0, unitPrice: 2 }] }), /line 0/);
});

test('accepts an ordinary line', () => {
  assert.doesNotThrow(() => assertOrder({ lines: [{ sku: 'x', quantity: 1, unitPrice: 2 }] }));
});

test('keeps malformed line validation', () => {
  assert.throws(() => assertOrder({ lines: [{ sku: 'x', quantity: 1 }] }), /unitPrice/);
});
