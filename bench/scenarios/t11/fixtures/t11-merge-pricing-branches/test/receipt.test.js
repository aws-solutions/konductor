'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { receiptRows } = require('../src/receipt');

test('turns quote fields into receipt rows', () => {
  assert.deepEqual(receiptRows({ subtotal: 1, discount: 0, shipping: 2, tax: 3, total: 6 }), [
    ['Subtotal', 1], ['Discount', 0], ['Shipping', 2], ['Tax', 3], ['Total', 6]
  ]);
});
