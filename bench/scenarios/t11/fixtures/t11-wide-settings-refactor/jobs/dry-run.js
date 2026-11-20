'use strict';

const readSetting = require('../lib/conf').read;

module.exports = function buildDryRun() {
  const dryRun = readSetting("jobs.dryRun", false);
  const label = dryRun ? 'preview' : 'live';
  return { dryRun, label };
};
