'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('../lib/load-plugin');

test('loader finds the compact plugin by name', () => {
  assert.equal(loadPlugin('compact')('  many   spaces '), 'many spaces');
});

test('loader rejects malformed names', () => {
  assert.throws(() => loadPlugin('../secret'), /Unknown plugin/);
});
