'use strict';

const conf = require('../../lib/conf');

module.exports = function buildBillingTimeout() {
  const timeout = conf.read("billing.timeout", 1200);
  const seconds = timeout / 1000;
  return { timeout, seconds };
};
