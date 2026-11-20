'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildBillingRounding() {
  const mode = readSetting("billing.rounding.mode", "half-up");
  const description = 'round-' + mode;
  return { mode, description };
};
