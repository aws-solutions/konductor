'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toRoman, fromRoman } = require('../src/roman.js');

test('roman numerals follow docs/specs/roman.md', () => {
  assert.equal(toRoman(1994), 'MCMXCIV');
  assert.equal(fromRoman(' mcmxciv '), 1994);
  assert.throws(() => fromRoman('IIII'), SyntaxError);
  assert.throws(() => toRoman(4000), RangeError);
});
