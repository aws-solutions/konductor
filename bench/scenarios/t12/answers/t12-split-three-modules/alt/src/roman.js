'use strict';

// See docs/specs/roman.md. One digit table per place; the standard form is checked with one pattern.
const PLACES = [
  ['', 'M', 'MM', 'MMM'],
  ['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM'],
  ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'],
  ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'],
];
const STANDARD = /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const MIN = 1;
const MAX = 3999;

function toRoman(n) {
  if (!Number.isInteger(n) || n < MIN || n > MAX) throw new RangeError(`toRoman: expected an integer from ${MIN} to ${MAX}, got ${n}`);
  const digits = String(n).padStart(4, '0').split('').map(Number);
  return digits.map((d, place) => PLACES[place][d]).join('');
}

function fromRoman(s) {
  if (typeof s !== 'string') throw new TypeError('fromRoman: expected a string');
  const t = s.trim().toUpperCase();
  const m = t === '' ? null : STANDARD.exec(t);
  if (!m) throw new SyntaxError(`fromRoman: not a standard Roman numeral: ${s}`);
  return m.slice(1).reduce((sum, part, place) => sum + PLACES[place].indexOf(part) * 10 ** (3 - place), 0);
}

module.exports = { toRoman, fromRoman };
