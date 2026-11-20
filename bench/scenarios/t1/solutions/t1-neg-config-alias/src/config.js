const fs = require('node:fs');
const path = require('node:path');

function loadConfig(environment = process.env.NODE_ENV || 'development') {
  const name = environment === 'test' ? 'test.json' : 'default.json';
  const file = path.join(__dirname, '..', 'config', name);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hasOldName = Object.hasOwn(config, 'pollIntervalMs');
  const hasNewName = Object.hasOwn(config, 'pollingIntervalMs');

  if (hasOldName) {
    console.warn('Config key "pollIntervalMs" is deprecated; use "pollingIntervalMs" instead.');
  }
  if (!hasNewName) {
    config.pollingIntervalMs = config.pollIntervalMs;
  }

  // Keep the old property available to callers during the compatibility period.
  config.pollIntervalMs = config.pollingIntervalMs;
  return { ...config, environment };
}

module.exports = { loadConfig };
