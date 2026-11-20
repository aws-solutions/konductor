'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWarehouseIngest() {
  const timeout = conf.read("warehouse.timeout", 2000);
  const seconds = timeout / 1000;
  return { timeout, seconds };
};
