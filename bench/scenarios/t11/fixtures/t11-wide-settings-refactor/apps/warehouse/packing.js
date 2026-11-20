'use strict';

const { read } = require('../../lib');

module.exports = function buildWarehousePacking() {
  const station = read("warehouse.packing.station", "P1");
  const queue = station + '-queue';
  return { station, queue };
};
