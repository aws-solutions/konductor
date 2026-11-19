const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignature } = require('../src/webhook-signature');

test('signature utility accepts the exact signed bytes', () => {
  const rawBody = Buffer.from('{"id":"evt-test","amount":3,"currency":"usd"}');
  const timestamp = 1700000000;
  const value = crypto.createHmac('sha256', 'test-secret')
    .update(`${timestamp}.`).update(rawBody).digest('hex');
  assert.equal(verifySignature({ rawBody, header: `t=${timestamp},v1=${value}`, secrets: ['test-secret'], now: timestamp }), true);
});
