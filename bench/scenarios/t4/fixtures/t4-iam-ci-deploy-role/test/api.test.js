'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { health } = require('../api/health');
const { version } = require('../api/version');

test('health returns a JSON success response', () => {
  const result = health({ requestId: 'abc' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true, requestId: 'abc' });
});

test('version returns the release identifier', () => {
  assert.deepEqual(JSON.parse(version('release-7').body), { release: 'release-7' });
});
