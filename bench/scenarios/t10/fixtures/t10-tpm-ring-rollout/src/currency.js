'use strict';

function minorUnit(amount, currency = 'USD') {
  const digits = currency === 'JPY' ? 0 : 2;
  return Math.round(Number(amount) * (10 ** digits));
}

module.exports = { minorUnit };
