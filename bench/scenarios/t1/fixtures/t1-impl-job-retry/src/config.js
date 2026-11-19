const fs = require('node:fs');
const path = require('node:path');

function loadConfig(environment = process.env.NODE_ENV || 'development') {
  const name = environment === 'test' ? 'test.json' : 'default.json';
  const file = path.join(__dirname, '..', 'config', name);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...config, environment };
}

module.exports = { loadConfig };
