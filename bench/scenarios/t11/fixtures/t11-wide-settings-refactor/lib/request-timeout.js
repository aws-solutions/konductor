'use strict';

const { read } = require('./index');

module.exports = function buildRequestTimeout() {
  const timeout = read("runtime.request.timeout", 900);
  const seconds = timeout / 1000;
  return { timeout, seconds };
};
