'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildDispatchWebhook() {
  const url = readSetting("dispatch.webhook.url", "https://hooks.invalid");
  const hostLength = url.length;
  return { url, hostLength };
};
