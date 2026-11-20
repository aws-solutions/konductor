'use strict';

const { read } = require('../../lib');

module.exports = function buildBillingReceipt() {
  const prefix = read("billing.receipt.prefix", "R-");
  const sample = prefix + '9';
  return { prefix, sample };
};
