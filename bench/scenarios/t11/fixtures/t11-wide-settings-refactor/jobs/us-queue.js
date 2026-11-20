'use strict';

const conf = require('../lib/conf');

module.exports = function buildUsQueue(region = "us") {
  const settingPath = 'queues.' + region + '.url';
  const url = conf.read(settingPath, "https://queue.invalid");
  const health = url + '/health';
  return { url, health };
};
