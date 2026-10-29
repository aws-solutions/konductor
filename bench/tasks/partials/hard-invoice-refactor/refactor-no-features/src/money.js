'use strict';

const SYMBOL = { USD: '$', GBP: '\u00a3', JPY: '\u00a5' };
const group = (s, sep) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);

const digitsFor = (cur) => (cur === 'JPY' ? 0 : 2);

function roundFor(cur) {
  const f = Math.pow(10, digitsFor(cur));
  return (x) => Math.sign(x) * Math.round(Math.abs(x) * f) / f;
}

// Text report amount: symbol and grouping depend on the currency.
function formatMoney(n, cur) {
  const r = roundFor(cur);
  const neg = n < 0 && r(n) !== 0;
  const fixed = Math.abs(r(n)).toFixed(digitsFor(cur));
  const sym = SYMBOL[cur] !== undefined ? SYMBOL[cur] : `${cur} `;
  return (neg ? '-' : '') + sym + group(fixed, ',');
}

// CSV amount: no symbol, no grouping, never "-0.00".
function plainAmount(n, cur) {
  const v = roundFor(cur)(n);
  return (v === 0 ? 0 : v).toFixed(digitsFor(cur));
}

module.exports = { digitsFor, roundFor, formatMoney, plainAmount };
