const test = require('node:test');
const assert = require('node:assert/strict');

test('the service test harness is available without network access', () => {
  assert.equal(typeof require('node:http').createServer, 'function');
});
