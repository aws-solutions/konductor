'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertOrder } = require('../src/validators');

function badLine(quantity, unitPrice = 3) {
  return { lines: [{ sku: 'x', quantity, unitPrice }] };
}

function expectsLineError(order, field) {
  assert.throws(() => assertOrder(order), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /line 0/);
    assert.match(error.message, new RegExp(field));
    return true;
  });
}

test('rejects zero quantity', () => {
  expectsLineError(badLine(0), 'quantity');
});

test('rejects negative quantity', () => {
  expectsLineError(badLine(-2), 'quantity');
});

test('rejects fractional quantity', () => {
  expectsLineError(badLine(2.25), 'quantity');
});

test('rejects nonnumeric quantity', () => {
  expectsLineError(badLine('2'), 'quantity');
});

test('rejects negative unit price', () => {
  expectsLineError(badLine(1, -0.5), 'unitPrice');
});

test('accepts an ordinary line', () => {
  assert.doesNotThrow(() => assertOrder(badLine(1, 0)));
});
