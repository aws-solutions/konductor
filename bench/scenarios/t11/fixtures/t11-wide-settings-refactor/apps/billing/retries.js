'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildBillingRetries() {
  const retries = readSetting("billing.retries", 0);
  const attempts = retries + 1;
  return { retries, attempts };
};
