const fs = require('node:fs');
const path = require('node:path');

function loadConfig(filename = path.join(__dirname, '..', 'config', 'default.json')) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

module.exports = { loadConfig };
