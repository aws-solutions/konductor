const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('default config has a queue and polling interval', () => {
  const config = loadConfig('development');
  assert.equal(config.queueFile, 'data/jobs.json');
  assert.equal(typeof config.pollingIntervalMs, 'number');
});

test('test config is quiet', () => {
  assert.equal(loadConfig('test').logLevel, 'silent');
});
