'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('loads the development carrier settings', () => {
  assert.match(loadConfig('development').carrier.url, /sandbox/);
});

test('loads production port settings', () => {
  assert.equal(loadConfig('production').port, 8080);
});
