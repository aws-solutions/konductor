'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Settings } = require('../src/settings');

test('coerces the documented service fields', () => {
  const settings = new Settings({ SERVICE_NAME: 'worker', PORT: '42', DEBUG: 'yes', TIMEOUT_MS: '9' });
  assert.equal(settings.serviceName, 'worker');
  assert.equal(settings.port, 42);
  assert.equal(settings.debug, true);
  assert.equal(settings.timeoutMs, 9);
});
