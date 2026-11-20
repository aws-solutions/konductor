'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildDispatchCallback() {
  const path = read("dispatch.callback.path", "/callbacks");
  const healthPath = path + '/status';
  return { path, healthPath };
};
