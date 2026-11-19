'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadConfig(name = 'default') {
  const filename = path.join(__dirname, '..', 'config', `${name}.json`);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

module.exports = { loadConfig };
