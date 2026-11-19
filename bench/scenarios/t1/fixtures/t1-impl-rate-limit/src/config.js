const fs = require('node:fs');
const path = require('node:path');

function merge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      result[key] = merge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function loadConfig(environment = process.env.NODE_ENV || 'development') {
  const root = path.resolve(__dirname, '..');
  const defaults = JSON.parse(fs.readFileSync(path.join(root, 'config', 'default.json'), 'utf8'));
  const file = path.join(root, 'config', `${environment}.json`);
  if (!fs.existsSync(file)) return defaults;
  return merge(defaults, JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { loadConfig, merge };
