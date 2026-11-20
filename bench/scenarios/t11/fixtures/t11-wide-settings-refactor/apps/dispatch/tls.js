'use strict';

const conf = require('../../lib/conf');

module.exports = function buildDispatchTls() {
  const required = conf.read("dispatch.tls.required", false);
  const mode = required ? 'secure' : 'plain';
  return { required, mode };
};
