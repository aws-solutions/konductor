'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { loadConfig } = require('../src/config');

test('loads the checked-in defaults', () => {
  const config = loadConfig(path.join(__dirname, '..', 'config', 'test.json'));
  assert.equal(config.port, 0);
  assert.equal(config.maxUploadBytes, 65536);
  assert.equal(config.logLevel, 'silent');
});
