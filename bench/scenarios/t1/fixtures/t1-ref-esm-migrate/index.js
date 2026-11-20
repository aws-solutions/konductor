'use strict';
const { format } = require('./lib/format');
const { loadPlugin } = require('./lib/load-plugin');
const { readBanner } = require('./lib/read-banner');
const { manifest } = require('./lib/manifest');
const { cycleValue } = require('./lib/cycle-value');

function lantern(value, options) {
  return format(value, options);
}

lantern.format = format;
lantern.loadPlugin = loadPlugin;
lantern.banner = readBanner();
lantern.manifest = manifest;
lantern.cycleValue = cycleValue;

module.exports = lantern;
module.exports.format = format;
module.exports.loadPlugin = loadPlugin;
module.exports.banner = lantern.banner;
module.exports.manifest = manifest;
module.exports.cycleValue = cycleValue;
