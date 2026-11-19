"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { documentKey, exportKey, metadataKey } = require('../src/storage-path');

test('storage keys have stable prefixes', () => {
  assert.equal(documentKey('tenant-07', 'brief.pdf'), 'tenants/tenant-07/brief.pdf');
  assert.equal(exportKey('tenant-07', 'brief.pdf'), 'exports/tenant-07/brief.pdf');
  assert.deepEqual(metadataKey('tenant-07'), { tenantId: 'tenant-07' });
});
