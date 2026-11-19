'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sign, verifySignature } = require('../prototype/verify');

test('signing is stable for a body and secret', () => {
  const body = JSON.stringify({ hello: 'world' });
  const signature = sign('demo-secret-123', body);
  assert.equal(signature.length, 64);
  assert.equal(verifySignature('demo-secret-123', body, signature), true);
  assert.equal(verifySignature('other-demo-secret', body, signature), false);
});
