'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toRoman, fromRoman } = require('../src/roman.js');

describe('src/roman.js', () => {
  it('writes the spec examples', () => {
    assert.equal(toRoman(1994), 'MCMXCIV');
    assert.equal(toRoman(3999), 'MMMCMXCIX');
    assert.equal(toRoman(4), 'IV');
  });

  it('refuses numbers out of range', () => {
    for (const bad of [0, -1, 4000, 2.5, '7']) assert.throws(() => toRoman(bad), RangeError);
  });

  it('reads either case with spaces around', () => {
    assert.equal(fromRoman(' mcmxciv '), 1994);
  });

  it('refuses non-standard forms and non-strings', () => {
    for (const bad of ['IIII', 'IC', 'VX', 'MMMM', 'XXC', '']) assert.throws(() => fromRoman(bad), SyntaxError);
    assert.throws(() => fromRoman(12), TypeError);
  });

  it('round-trips every value', () => {
    for (let n = 1; n <= 3999; n++) assert.equal(fromRoman(toRoman(n)), n);
  });
});
