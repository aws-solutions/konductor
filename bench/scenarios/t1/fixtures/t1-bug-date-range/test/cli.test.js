const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../src/cli');

test('exports a callable report entry point', () => {
  assert.equal(typeof main, 'function');
});
