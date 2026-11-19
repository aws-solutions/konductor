"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestContext } = require('../src/request-context');

test('request context normalizes an ordinary tier', () => {
  assert.deepEqual(createRequestContext({ requestId: 'req-123456', tenantId: 'tenant-07', tier: 'basic' }), { requestId: 'req-123456', tenantId: 'tenant-07', tier: 'standard' });
});

test('request context rejects malformed ids', () => {
  assert.throws(() => createRequestContext({ requestId: 'short', tenantId: 'tenant-07' }));
});
