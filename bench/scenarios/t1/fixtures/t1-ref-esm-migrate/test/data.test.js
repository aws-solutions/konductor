'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readBanner } = require('../lib/read-banner');
const manifest = require('../lib/manifest').manifest;

test('data files remain available to their modules', () => {
  assert.equal(readBanner(), 'Lantern Kit\n');
  assert.equal(manifest.format, 'lantern-v1');
});
