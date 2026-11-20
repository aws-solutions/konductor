'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildDispatchAlert() {
  const enabled = read("dispatch.alert.enabled", false);
  const priority = enabled ? 1 : 0;
  return { enabled, priority };
};
