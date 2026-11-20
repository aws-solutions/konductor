'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWarehouseZone() {
  const zone = conf.read("warehouse.zones.primary", "south-1");
  const label = zone + '-dock';
  return { zone, label };
};
