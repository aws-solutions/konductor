'use strict';

// Integer division with rounding of the exact quotient num/den (den > 0, num >= 0).
function divRound(num, den, mode) {
  const q = Math.floor(num / den);
  const r = num - q * den;
  if (2 * r < den) return q;
  if (2 * r > den) return q + 1;
  return mode === 'half-even' ? (q % 2 === 0 ? q : q + 1) : q + 1;
}

module.exports = { divRound };
