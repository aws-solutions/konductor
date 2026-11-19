'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));

function readConfig(env = process.env) {
  const port = Number.parseInt(env.TRAILHEAD_PORT || defaults.port, 10);
  return {
    ...defaults,
    port: Number.isInteger(port) && port > 0 ? port : defaults.port,
    host: env.TRAILHEAD_HOST || defaults.host,
  };
}

module.exports = { readConfig };
