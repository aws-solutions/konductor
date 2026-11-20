'use strict';

const conf = require('../../lib/conf');

module.exports = function buildRetryPolicy() {
  const retries = conf.read("dispatch.retries", 2);
  const budget = retries * 2;
  return { retries, budget };
};
