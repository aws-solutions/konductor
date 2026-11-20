'use strict';

const { loadSettings } = require('../src');

function describeWorker(settings) {
  return `${settings.serviceName} listens on ${settings.port} with ${settings.logLevel} logging`;
}

if (require.main === module) console.log(describeWorker(loadSettings()));
module.exports = { describeWorker };
