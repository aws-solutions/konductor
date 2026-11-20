'use strict';

const conf = require('../lib/conf');

module.exports = function buildNightlyJob() {
  const hour = conf.read("jobs.nightly.hour", 1);
  const label = 'hour-' + hour;
  return { hour, label };
};
