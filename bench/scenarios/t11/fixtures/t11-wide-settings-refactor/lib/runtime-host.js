'use strict';

const readSetting = require('./conf').read;

module.exports = function buildRuntimeHost() {
  const host = readSetting("runtime.host", "localhost");
  const url = 'https://' + host;
  return { host, url };
};
