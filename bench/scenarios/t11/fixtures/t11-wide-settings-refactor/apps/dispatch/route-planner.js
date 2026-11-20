'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildRoutePlanner() {
  const base = readSetting("dispatch.routes.primary", "/fallback/routes");
  const planningUrl = base + '/plan';
  return { base, planningUrl };
};
