'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src');

test('loads the checked-in shipping table', () => {
  const config = loadConfig();
  assert.equal(config.shipping.standard, 4.99);
  assert.equal(config.shipping.express, 12.5);
});
