'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildWarehouseLabel() {
  const prefix = readSetting("warehouse.labels.prefix", "WH-");
  const sample = prefix + 'A';
  return { prefix, sample };
};
