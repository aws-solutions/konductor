const fs = require('node:fs');
const path = require('node:path');

const DEPRECATED_KEYS = {
  pollIntervalMs: 'pollingIntervalMs'
};

function loadConfig(environment = process.env.NODE_ENV || 'development') {
  const name = environment === 'test' ? 'test.json' : 'default.json';
  const file = path.join(__dirname, '..', 'config', name);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  
  // Handle deprecated key aliases
  for (const [oldKey, newKey] of Object.entries(DEPRECATED_KEYS)) {
    if (oldKey in config) {
      console.warn(`Deprecation warning: "${oldKey}" is deprecated, use "${newKey}" instead`);
      // New key takes precedence if both are present
      if (!(newKey in config)) config[newKey] = config[oldKey];
    }
    // Callers may still read the old name for one release.
    if (newKey in config) config[oldKey] = config[newKey];
  }
  
  return { ...config, environment };
}

module.exports = { loadConfig };
