'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWarehouseScanner() {
  const endpoint = conf.read("warehouse.scanner.endpoint", "https://scanner.invalid");
  const health = endpoint + '/health';
  return { endpoint, health };
};
