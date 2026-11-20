'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildWarehouseCold() {
  const maxCelsius = read("warehouse.cold.maxCelsius", 4);
  const warning = maxCelsius + 2;
  return { maxCelsius, warning };
};
