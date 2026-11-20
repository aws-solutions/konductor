'use strict';

const conf = require('../../lib/conf');

module.exports = function buildDispatchManifest() {
  const timeout = conf.read("dispatch.timeout", 4500);
  const deadline = timeout + 300;
  return { timeout, deadline };
};
