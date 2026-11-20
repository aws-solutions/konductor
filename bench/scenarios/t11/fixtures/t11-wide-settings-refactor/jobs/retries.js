'use strict';

const conf = require('../lib/conf');

module.exports = function buildJobRetries() {
  const retries = conf.read("jobs.retries", 2);
  const budget = retries * 3;
  return { retries, budget };
};
