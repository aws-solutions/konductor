const fs = require('node:fs');
const path = require('node:path');

const DEPRECATED_KEYS = {
  pollIntervalMs: 'pollingIntervalMs'
};

const warnedKeys = new Set();

function loadConfig(environment = process.env.NODE_ENV || 'development') {
  const name = environment === 'test' ? 'test.json' : 'default.json';
  const file = path.join(__dirname, '..', 'config', name);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  // Handle deprecated key aliases
  for (const [oldKey, newKey] of Object.entries(DEPRECATED_KEYS)) {
    if (oldKey in config) {
      if (!warnedKeys.has(oldKey)) {
        console.warn(`Deprecation warning: "${oldKey}" is deprecated, use "${newKey}" instead`);
        warnedKeys.add(oldKey);
      }
      // New key takes precedence if both are present
      if (!(newKey in config)) {
        config[newKey] = config[oldKey];
      }
      delete config[oldKey];
    }
  }
  
  return { ...config, environment };
}

module.exports = { loadConfig };
