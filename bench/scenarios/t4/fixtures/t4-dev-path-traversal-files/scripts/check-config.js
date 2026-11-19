'use strict';

const { loadConfig } = require('../src/config');
const config = loadConfig();
if (!Number.isInteger(config.port) || config.port < 0) {
  throw new Error('port must be a non-negative integer');
}
process.stdout.write(`configuration ready for port ${config.port}\n`);
