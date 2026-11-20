'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWeight } = require('../src/weight.js');

test('PD-41: pounds convert at 0.45359237 kg', () => {
  assert.equal(parseWeight('3 lb'), 1.361);
  assert.equal(parseWeight('10 lb'), 4.536);
});

test('PD-41: units in any case', () => {
  assert.equal(parseWeight('10 LB'), 4.536);
  assert.equal(parseWeight('2 KG'), 2);
  assert.equal(parseWeight('2 Kg'), 2);
  assert.equal(parseWeight('750 G'), 0.75);
  assert.throws(() => parseWeight('5 STONE'), /bad weight/);
});
