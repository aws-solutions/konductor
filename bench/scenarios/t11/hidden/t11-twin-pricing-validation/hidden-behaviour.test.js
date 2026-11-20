'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sourceCandidates = [
  path.join(__dirname, '..', 'fixture', 'src'),
  path.join(__dirname, 'fixture', 'src'),
  path.join(__dirname, '..', 'src'),
  path.join(process.cwd(), 'src')
];
const sourcePath = sourceCandidates.find((candidate) => fs.existsSync(candidate));
const { calculateOrder } = require(sourcePath);

function assertInvalid(order, index, field) {
  assert.throws(
    () => calculateOrder(order),
    (error) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, new RegExp(`line ${index}\\b`));
      assert.match(error.message, new RegExp(field));
      return true;
    }
  );
}

test('rejects a zero quantity on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: 0, unitPrice: 8.5 }] }, 0, 'quantity');
});

test('rejects a negative quantity on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: -1, unitPrice: 8.5 }] }, 0, 'quantity');
});

test('rejects a fractional quantity on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: 1.5, unitPrice: 8.5 }] }, 0, 'quantity');
});

test('rejects a string quantity on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: '2', unitPrice: 8.5 }] }, 0, 'quantity');
});

test('rejects a null quantity on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: null, unitPrice: 8.5 }] }, 0, 'quantity');
});

test('rejects a NaN quantity on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: NaN, unitPrice: 8.5 }] }, 0, 'quantity');
});

test('rejects a negative unit price on line zero', () => {
  assertInvalid({ lines: [{ sku: 'mug-blue', quantity: 1, unitPrice: -0.01 }] }, 0, 'unitPrice');
});

test('reports the zero-based index for a later bad quantity', () => {
  assertInvalid({
    lines: [
      { sku: 'mug-blue', quantity: 1, unitPrice: 8.5 },
      { sku: 'tea-tin', quantity: -2, unitPrice: 4 }
    ]
  }, 1, 'quantity');
});

test('reports the zero-based index for a later bad price', () => {
  assertInvalid({
    lines: [
      { sku: 'mug-blue', quantity: 1, unitPrice: 8.5 },
      { sku: 'tea-tin', quantity: 2, unitPrice: -4 }
    ]
  }, 1, 'unitPrice');
});

test('keeps the existing quote for a valid cart', () => {
  assert.deepEqual(calculateOrder({
    lines: [
      { sku: 'mug-blue', quantity: 2, unitPrice: 8.5 },
      { sku: 'tea-tin', quantity: 3, unitPrice: 4 }
    ]
  }), {
    subtotal: 29,
    discount: 0,
    shipping: 4.99,
    tax: 0,
    total: 33.99
  });
});
