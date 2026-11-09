'use strict';

const fs = require('node:fs');

// Called once at startup, before the service takes traffic, so a blocking read is fine here.
function loadConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadConfig };
