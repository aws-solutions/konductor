const fs = require('node:fs');
const path = require('node:path');

function loadConfig(file = path.join(__dirname, '..', 'config', 'default.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadConfig };
