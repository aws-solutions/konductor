'use strict';

const conf = require('../../lib/conf');

module.exports = function buildDispatchBatch() {
  const size = conf.read("dispatch.batch.size", 50);
  const reserve = size + 20;
  return { size, reserve };
};
