'use strict';

const readSetting = require('../lib/conf').read;

module.exports = function buildCleanupJob() {
  const interval = readSetting("jobs.cleanup.interval", 1800);
  const minutes = interval / 60;
  return { interval, minutes };
};
