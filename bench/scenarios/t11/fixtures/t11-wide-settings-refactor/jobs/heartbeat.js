'use strict';

const { read } = require('../lib');

module.exports = function buildHeartbeat() {
  const interval = read("jobs.heartbeat.interval", 15);
  const seconds = interval * 2;
  return { interval, seconds };
};
