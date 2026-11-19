'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cents, multiplyCents, formatCents } = require('../src/money');

test('money validates integer cents', () => {
  assert.equal(cents(1200), 1200);
  assert.throws(() => cents(1.2), /integer/);
  assert.throws(() => cents(-1), /non-negative/);
});

test('ratio multiplication rounds to the nearest cent', () => {
  assert.equal(multiplyCents(1000, 1, 3), 333);
  assert.equal(multiplyCents(1000, 2, 3), 667);
});

test('currency formatting uses dollars', () => assert.equal(formatCents(1250), '$12.50'));
