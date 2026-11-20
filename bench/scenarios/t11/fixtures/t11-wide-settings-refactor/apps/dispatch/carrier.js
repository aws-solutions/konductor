'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildDispatchCarrier() {
  const code = readSetting("dispatch.carrier.code", "XX");
  const slug = code.toLowerCase();
  return { code, slug };
};
