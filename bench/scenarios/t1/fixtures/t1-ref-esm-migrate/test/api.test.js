'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lantern = require('../');

test('the callable API formats a trimmed message', () => {
  assert.equal(lantern('  hello  '), '> hello');
  assert.equal(lantern.format('hello', { prefix: '#' }), '# hello');
});

test('the callable carries package metadata', () => {
  assert.equal(lantern.manifest.name, 'lantern-kit');
  assert.equal(lantern.banner, 'Lantern Kit\n');
});
