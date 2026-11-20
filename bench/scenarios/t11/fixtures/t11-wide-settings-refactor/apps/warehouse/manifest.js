'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWarehouseManifest() {
  const version = conf.read("warehouse.manifest.version", "v1");
  const label = 'manifest-' + version;
  return { version, label };
};
