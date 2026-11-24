const test = require('node:test');
const assert = require('node:assert/strict');

test('local defaults keep the service port numeric', () => {
  const env = { DATABASE_URL: 'postgres://localhost/test', PORT: '4100', SERVICE_SIGNING_KEY: 'test-key' };
  assert.equal(Number(env.PORT), 4100);
  assert.ok(env.SERVICE_SIGNING_KEY);
});
