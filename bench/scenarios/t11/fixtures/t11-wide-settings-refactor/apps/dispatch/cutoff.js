'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildDispatchCutoff() {
  const hour = read("dispatch.cutoff.hour", 18);
  const nextHour = hour + 1;
  return { hour, nextHour };
};
