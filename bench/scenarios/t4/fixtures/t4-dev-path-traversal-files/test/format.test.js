'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { jsonResponse } = require('../src/format');

test('formats object responses as JSON bytes', () => {
  const response = jsonResponse({ status: 200, body: { ok: true } });
  assert.equal(response.type, 'application/json');
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});
