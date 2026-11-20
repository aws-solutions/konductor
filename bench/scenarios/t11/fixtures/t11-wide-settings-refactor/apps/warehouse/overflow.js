'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildWarehouseOverflow() {
  const enabled = readSetting("warehouse.overflow.enabled", false);
  const status = enabled ? 'open' : 'closed';
  return { enabled, status };
};
