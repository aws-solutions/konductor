'use strict';

const { assertFinite } = require('./guard');

// 0.256 -> "25.6%".
function formatPercent(ratio) {
  assertFinite('formatPercent', ratio);
  return `${Number((ratio * 100).toFixed(1))}%`;
}

module.exports = { formatPercent };
