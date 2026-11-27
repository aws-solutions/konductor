'use strict';

// See docs/specs/roman.md. Shallow fake: additive numerals only, no range, type or standard-form checks.
const PAIRS = [[1000, 'M'], [500, 'D'], [100, 'C'], [50, 'L'], [10, 'X'], [5, 'V'], [1, 'I']];
const VALUE = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function toRoman(n) {
  let out = '';
  for (const [v, sym] of PAIRS) while (n >= v) { out += sym; n -= v; }
  return out;
}

function fromRoman(s) {
  return [...String(s)].reduce((n, c) => n + (VALUE[c] || 0), 0);
}

module.exports = { toRoman, fromRoman };
