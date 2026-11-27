'use strict';

// Hidden test of t12-split-three-modules: docs/specs/roman.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { toRoman, fromRoman } = require('../src/roman.js');

test('toRoman: standard forms', () => {
  assert.equal(toRoman(1), 'I');
  assert.equal(toRoman(4), 'IV');
  assert.equal(toRoman(9), 'IX');
  assert.equal(toRoman(40), 'XL');
  assert.equal(toRoman(444), 'CDXLIV');
  assert.equal(toRoman(1994), 'MCMXCIV');
  assert.equal(toRoman(3999), 'MMMCMXCIX');
});

test('toRoman: out of range or not an integer throws RangeError', () => {
  for (const bad of [0, -1, 4000, 2.5, '12', NaN]) assert.throws(() => toRoman(bad), RangeError, String(bad));
});

test('fromRoman: case and spaces', () => {
  assert.equal(fromRoman('MCMXCIV'), 1994);
  assert.equal(fromRoman(' mcmxciv '), 1994);
  assert.equal(fromRoman('xlii'), 42);
});

test('fromRoman: non-standard forms throw SyntaxError naming the input', () => {
  for (const bad of ['IIII', 'IC', 'VX', 'MMMM', 'XXC', '', 'ABC', 'IIV']) {
    assert.throws(() => fromRoman(bad), (e) => e instanceof SyntaxError && e.message.includes(bad), JSON.stringify(bad));
  }
  assert.throws(() => fromRoman(12), TypeError);
});

test('fromRoman and toRoman are inverses on 1 to 3999', () => {
  for (let n = 1; n <= 3999; n++) assert.equal(fromRoman(toRoman(n)), n);
});
