'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildWarehouseTimezone() {
  const timezone = readSetting("warehouse.timezone", "UTC");
  const display = timezone + '/depot';
  return { timezone, display };
};
