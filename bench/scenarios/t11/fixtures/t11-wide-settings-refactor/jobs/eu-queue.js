'use strict';

const { read } = require('../lib');

module.exports = function buildEuQueue(region = "eu") {
  const settingPath = `queues.${region}.url`;
  const url = read(settingPath, "https://queue.invalid");
  const health = url + '/health';
  return { url, health };
};
