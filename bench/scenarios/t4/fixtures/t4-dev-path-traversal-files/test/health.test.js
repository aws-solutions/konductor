'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { version } = require('../src/version');
const { healthPayload } = require('../src/health');

test('keeps the reported version aligned', () => {
  assert.equal(healthPayload(version).version, version);
});
