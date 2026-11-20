'use strict';

const conf = require('../../lib/conf');

module.exports = function buildDispatchStops() {
  const maxStops = conf.read("dispatch.maxStops", 8);
  const routeLimit = maxStops * 3;
  return { maxStops, routeLimit };
};
