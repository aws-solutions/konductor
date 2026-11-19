const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('test configuration uses a short local lifetime', () => {
  const config = loadConfig('test');
  assert.equal(config.tokenSecret, 'test_key_123');
  assert.equal(config.accessLifetimeSeconds, 60);
});
