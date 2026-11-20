'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildWarehouseCapacity() {
  const capacity = read("warehouse.capacity", 400);
  const half = capacity / 2;
  return { capacity, half };
};
