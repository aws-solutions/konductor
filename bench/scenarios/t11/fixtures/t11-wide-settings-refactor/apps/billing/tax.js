'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildBillingTax() {
  const rate = read("billing.tax.rate", 0);
  const percent = rate * 100;
  return { rate, percent };
};
