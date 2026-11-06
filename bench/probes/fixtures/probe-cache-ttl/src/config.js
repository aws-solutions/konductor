'use strict';

const { parseDuration } = require('./duration.js');

function loadConfig(raw = require('../config/app.json')) {
  return {
    service: raw.service,
    cache: {
      ttlMs: Number(raw.cache.ttl),
      maxEntries: raw.cache.maxEntries,
    },
    retry: {
      delayMs: parseDuration(raw.retry.delay),
      attempts: raw.retry.attempts,
    },
  };
}

module.exports = { loadConfig };
