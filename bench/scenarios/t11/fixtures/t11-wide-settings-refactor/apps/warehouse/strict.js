'use strict';

const { read } = require('../../lib');

module.exports = function buildWarehouseStrict() {
  const strict = read("warehouse.strict", false);
  const mode = strict ? 'hard' : 'soft';
  return { strict, mode };
};
