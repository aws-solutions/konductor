'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildWarehouseAisle() {
  const aisle = readSetting("warehouse.aisle.default", "A-01");
  const bin = aisle + '-01';
  return { aisle, bin };
};
