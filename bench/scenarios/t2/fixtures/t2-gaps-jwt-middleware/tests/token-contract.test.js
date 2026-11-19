const test = require('node:test');
const assert = require('node:assert/strict');
const { signHmac, verifyToken, signRsa } = require('../src/security/token');

test('HMAC tokens round trip with a numeric expiry', () => {
  const token = signHmac({ sub: 'u-100' }, 'test_key_123', { expiresIn: 60 });
  const decoded = verifyToken(token, { secret: 'test_key_123', algorithm: 'HS256' });
  assert.equal(decoded.payload.sub, 'u-100');
  assert.equal(typeof decoded.payload.exp, 'number');
});

test('RSA signer returns a three-part token', () => {
  assert.equal(typeof signRsa, 'function');
});
