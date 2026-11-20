'use strict';

const conf = require('../../lib/conf');

module.exports = function buildBillingExport() {
  const format = conf.read("billing.export.format", "json");
  const extension = '.' + format;
  return { format, extension };
};
