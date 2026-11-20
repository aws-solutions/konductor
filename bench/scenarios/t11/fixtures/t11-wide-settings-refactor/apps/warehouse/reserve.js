'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildWarehouseReserve() {
  const percent = read("warehouse.reserve.percent", 10);
  const available = 100 - percent;
  return { percent, available };
};
