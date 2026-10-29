'use strict';

const { assertFinite } = require('./guard');

// 1234567.5 -> "1,234,567.5". At most one decimal place, trailing ".0" dropped.
function formatNumber(n) {
  assertFinite('formatNumber', n);
  const fixed = n.toFixed(1).replace(/\.0$/, '');
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${grouped}.${dec}` : grouped;
}

module.exports = { formatNumber };
