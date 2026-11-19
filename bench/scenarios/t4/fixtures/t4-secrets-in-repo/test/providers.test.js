const test = require('node:test');
const assert = require('node:assert/strict');
const { createSmsProvider } = require('../src/providers/sms');

test('provider passes authorization to its transport', () => {
  let request;
  const provider = createSmsProvider({ token: 'token-for-test', transport: (value) => { request = value; return 'ok'; } });
  assert.equal(provider.send('+1', 'hello'), 'ok');
  assert.equal(request.authorization, 'Bearer token-for-test');
});
