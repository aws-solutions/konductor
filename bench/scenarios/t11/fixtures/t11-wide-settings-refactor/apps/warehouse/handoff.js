'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWarehouseHandoff() {
  const delay = conf.read("warehouse.handoff.delay", 60);
  const minutes = delay / 60;
  return { delay, minutes };
};
