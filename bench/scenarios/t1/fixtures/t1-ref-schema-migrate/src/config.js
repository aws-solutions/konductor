const fs = require('node:fs');
const path = require('node:path');

function readConfig(environment = process.env.NODE_ENV || 'default') {
  const file = path.join(__dirname, '..', 'config', `${environment}.json`);
  const fallback = path.join(__dirname, '..', 'config', 'default.json');
  const selected = fs.existsSync(file) ? file : fallback;
  return JSON.parse(fs.readFileSync(selected, 'utf8'));
}

module.exports = { readConfig };
