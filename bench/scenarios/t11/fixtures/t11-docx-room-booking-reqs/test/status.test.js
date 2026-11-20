const test = require('node:test');
const assert = require('node:assert/strict');
const { status } = require('../src/status');

test('reports known service state', () => {
  assert.equal(status('catalogue'), 'ready');
  assert.equal(status('member-portal'), 'ready');
});

test('does not invent state for an unknown service', () => {
  assert.equal(status('archive'), 'unknown');
});
