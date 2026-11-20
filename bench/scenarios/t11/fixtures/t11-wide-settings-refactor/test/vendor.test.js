const test = require('node:test');
const assert = require('node:assert/strict');
const vendor = require('../third_party/tiny-settings');

test('the vendored setting helper remains independent', () => {
  assert.equal(vendor.read('vendor.mode', 'open'), 'sealed');
  assert.equal(vendor.read('unknown', 'open'), 'open');
});
