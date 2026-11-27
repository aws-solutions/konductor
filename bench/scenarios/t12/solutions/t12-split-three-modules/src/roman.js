'use strict';

// See docs/specs/roman.md.
const PAIRS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const VALUE = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError(`toRoman: ${n} is not an integer from 1 to 3999`);
  let out = '';
  for (const [v, sym] of PAIRS) while (n >= v) { out += sym; n -= v; }
  return out;
}

function fromRoman(s) {
  if (typeof s !== 'string') throw new TypeError('fromRoman: the numeral must be a string');
  const t = s.trim().toUpperCase();
  if (!/^[IVXLCDM]+$/.test(t)) throw new SyntaxError(`fromRoman: "${s}" is not a Roman numeral`);
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const v = VALUE[t[i]];
    n += i + 1 < t.length && VALUE[t[i + 1]] > v ? -v : v;
  }
  if (n < 1 || n > 3999 || toRoman(n) !== t) throw new SyntaxError(`fromRoman: "${s}" is not a standard Roman numeral`);
  return n;
}

module.exports = { toRoman, fromRoman };
