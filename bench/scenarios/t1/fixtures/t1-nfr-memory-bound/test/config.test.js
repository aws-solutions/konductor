const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loads the default runtime configuration', () => {
  const config = loadConfig();
  assert.equal(config.port, 8080);
  assert.equal(config.maxBodyBytes, 1048576);
});
