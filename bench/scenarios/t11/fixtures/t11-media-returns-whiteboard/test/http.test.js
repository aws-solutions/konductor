'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { route } = require('../src/http/router');
test('routes the two supported resource shapes', () => {
  assert.equal(route('POST', '/returns'), 'create-return');
  assert.equal(route('GET', '/returns/r-1'), 'get-return');
  assert.equal(route('DELETE', '/returns/r-1'), null);
});
