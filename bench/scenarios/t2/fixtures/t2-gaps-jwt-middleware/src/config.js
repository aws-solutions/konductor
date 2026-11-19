const fs = require('node:fs');
const path = require('node:path');

function loadConfig(name = process.env.NODE_ENV || 'default') {
  const file = path.join(__dirname, '..', 'config', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadConfig };
