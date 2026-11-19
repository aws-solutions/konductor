const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticateBearer } = require('../src/middleware/bearer-auth');
const { signHmac } = require('../src/security/token');

const config = { tokenSecret: 'test_key_123', accessLifetimeSeconds: 60 };
const tokenOptions = { token: require('../src/security/token'), config };

function request(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

test('accepts a valid bearer token', () => {
  const token = signHmac({ sub: 'u-100', role: 'admin' }, config.tokenSecret);
  const result = authenticateBearer(request(token), tokenOptions);
  assert.equal(result.ok, true);
  assert.equal(result.claims.sub, 'u-100');
});

test('rejects a missing authorization header', () => {
  const result = authenticateBearer({ headers: {} }, tokenOptions);
  assert.equal(result.response.status, 401);
});

test('rejects an empty bearer value', () => {
  const result = authenticateBearer({ headers: { authorization: 'Bearer ' } }, tokenOptions);
  assert.equal(result.response.status, 401);
});
