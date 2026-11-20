const test = require('node:test');
const assert = require('node:assert/strict');
const { themeClass } = require('../src/theme.js');

test('theme names are constrained to supported options', () => {
  assert.equal(themeClass('paper'), 'theme-paper');
  assert.equal(themeClass('neon'), 'theme-mist');
});
