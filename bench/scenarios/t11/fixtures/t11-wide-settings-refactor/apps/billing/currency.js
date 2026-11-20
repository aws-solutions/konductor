'use strict';

const conf = require('../../lib/conf');

module.exports = function buildBillingCurrency() {
  const currency = conf.read("billing.currency", "USD");
  const label = currency + '-ledger';
  return { currency, label };
};
