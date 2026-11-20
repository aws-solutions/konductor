'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertOrder } = require('../src/validators');

function invalidLine(quantity, unitPrice = 2) {
  return { lines: [{ sku: 'x', quantity, unitPrice }] };
}

test('rejects zero quantity with its line index', () => {
  assert.throws(() => assertOrder(invalidLine(0)), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /line 0/);
    assert.match(error.message, /quantity/);
    return true;
  });
});

test('rejects negative quantity with its line index', () => {
  assert.throws(() => assertOrder(invalidLine(-1)), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /line 0/);
    assert.match(error.message, /quantity/);
    return true;
  });
});

test('rejects fractional quantity with its line index', () => {
  assert.throws(() => assertOrder(invalidLine(0.5)), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /line 0/);
    assert.match(error.message, /quantity/);
    return true;
  });
});

test('rejects negative prices with their line index', () => {
  assert.throws(() => assertOrder(invalidLine(1, -2)), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /line 0/);
    assert.match(error.message, /unitPrice/);
    return true;
  });
});

test('accepts a positive integer quantity and nonnegative price', () => {
  assert.doesNotThrow(() => assertOrder(invalidLine(3, 0)));
});
