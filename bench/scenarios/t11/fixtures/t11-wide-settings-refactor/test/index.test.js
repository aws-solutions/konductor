const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../lib');

test('the shared index exposes the current reader and service tags', () => {
  assert.equal(api.value('dispatch', 'currency', { fallback: 'GBP' }), 'USD');
  assert.equal(api.serviceTag('billing'), 'harborline:billing');
});
