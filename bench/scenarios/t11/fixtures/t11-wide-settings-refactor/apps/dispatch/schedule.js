'use strict';

const conf = require('../../lib/conf');

module.exports = function buildDispatchSchedule() {
  const window = conf.read("dispatch.schedule.window", 15);
  const grace = window + 5;
  return { window, grace };
};
