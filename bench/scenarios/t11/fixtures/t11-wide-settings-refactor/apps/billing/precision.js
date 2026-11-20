'use strict';

const { read } = require('../../lib');

module.exports = function buildBillingPrecision() {
  const precision = read("billing.precision", 2);
  const factor = 10 ** precision;
  return { precision, factor };
};
