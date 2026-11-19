'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig } = require('../src/config');

test('config accepts a positive port', () => {
  assert.equal(readConfig({ TRAILHEAD_PORT: '4310' }).port, 4310);
});
