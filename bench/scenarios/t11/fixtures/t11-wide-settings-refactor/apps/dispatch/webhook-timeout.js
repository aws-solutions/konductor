'use strict';

const conf = require('../../lib/conf');

module.exports = function buildWebhookTimeout() {
  const timeout = conf.read("dispatch.webhook.timeout", 1000);
  const seconds = timeout / 1000;
  return { timeout, seconds };
};
