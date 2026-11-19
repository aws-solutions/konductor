const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignature } = require('../src/webhooks');

test('accepts a valid webhook signature', () => {
  const payload = JSON.stringify({ id: 'evt-example-1' });
  const secret = 'fixture-signing-value';
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(verifySignature(payload, signature, secret), true);
});

test('rejects a bad webhook signature', () => {
  assert.equal(verifySignature('body', 'not-a-signature', 'secret'), false);
});
