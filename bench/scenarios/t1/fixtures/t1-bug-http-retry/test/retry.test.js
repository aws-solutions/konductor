'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldRetry, DEFAULT_RETRY_STATUSES } = require('../src/retry');

test('has a small default set of transient status codes', () => {
  assert.ok(DEFAULT_RETRY_STATUSES.includes(503));
  assert.equal(shouldRetry(404), false);
});

test('accepts a caller supplied status list', () => {
  assert.equal(shouldRetry(409, [409]), true);
  assert.equal(shouldRetry(503, [409]), false);
});
