"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAudit } = require('../scripts/format-audit');

test('audit formatter excludes unneeded event fields', () => {
  const line = JSON.parse(formatAudit({ requestId: 'req-123456', operation: 'read', tenantId: 'tenant-07', outcome: 'ok', token: 'fake-token' }));
  assert.deepEqual(line, { requestId: 'req-123456', operation: 'read', tenantId: 'tenant-07', outcome: 'ok' });
});
