'use strict';

const { read } = require('../../lib');

module.exports = function buildDispatchCurrency() {
  const currency = read("dispatch.currency", "USD");
  const currencyTag = currency.toLowerCase();
  return { currency, currencyTag };
};
