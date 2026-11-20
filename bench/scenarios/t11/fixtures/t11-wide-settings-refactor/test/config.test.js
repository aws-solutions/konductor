const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../lib/config');

test('new config reader returns nested values and preserves falsy values', () => {
  assert.equal(config.value('dispatch', 'timeout', { fallback: 0 }), 4500);
  assert.equal(config.value('dispatch', 'optionalHeader', { fallback: '' }), '');
  assert.equal(config.value('warehouse', 'strict', { fallback: false }), false);
  assert.equal(config.value('billing', 'retries', { fallback: 0 }), 0);
  assert.equal(config.value('warehouse', 'labels.prefix', { fallback: 'x' }), 'WH-');
});
