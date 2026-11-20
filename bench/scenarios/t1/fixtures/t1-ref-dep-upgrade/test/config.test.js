const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('default config names table as the default format', () => {
  assert.equal(loadConfig().defaultFormat, 'table');
});
