'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildDispatchRegion() {
  const region = readSetting("dispatch.region", "south");
  const label = region.toUpperCase();
  return { region, label };
};
