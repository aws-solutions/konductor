'use strict';

const { read } = require('../../lib');

module.exports = function buildWarehouseBin() {
  const prefix = read("warehouse.bin.prefix", "BIN-");
  const example = prefix + '0001';
  return { prefix, example };
};
