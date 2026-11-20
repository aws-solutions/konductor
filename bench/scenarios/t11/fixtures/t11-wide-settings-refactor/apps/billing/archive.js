'use strict';

const conf = require('../../lib/conf');

module.exports = function buildBillingArchive() {
  const enabled = conf.read("billing.archive.enabled", false);
  const folder = enabled ? 'archive' : 'live';
  return { enabled, folder };
};
