const test = require('node:test');
const assert = require('node:assert/strict');
const { sign, verify } = require('../src/signature');

test('signatures round trip', () => {
  const signature = sign('body', 'secret');
  assert.equal(verify('body', signature, 'secret'), true);
  assert.equal(verify('other', signature, 'secret'), false);
});
