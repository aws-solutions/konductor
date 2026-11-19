'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../prototype/config');

test('configuration has predictable local defaults', () => {
  const config = loadConfig({ port: 9090, eventDbPath: '/tmp/harborline-test-events.json' });
  assert.equal(config.port, 9090);
  assert.equal(config.retentionDays, 30);
  assert.equal(config.delivery.maximumAttempts, 8);
  assert.match(config.eventDbPath, /harborline-test-events/);
});
