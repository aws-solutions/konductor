'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWarehouseCycle() {
  const days = conf.read("warehouse.cycle.days", 7);
  const weeks = days / 7;
  return { days, weeks };
};
