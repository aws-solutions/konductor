'use strict';

const conf = require('./conf');

module.exports = function buildCacheSettings() {
  const ttl = conf.read("runtime.cache.ttl", 600);
  const minutes = ttl / 60;
  return { ttl, minutes };
};
