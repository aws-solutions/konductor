import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveWebhook } from '../src/webhooks/receiver.js';
import { signatureFor } from '../src/webhooks/signatures.js';

function request(rawBody, extra = {}) {
  return {
    provider: 'source', rawBody,
    headers: { 'x-source-signature': signatureFor('secret', rawBody), ...extra },
    secret: 'secret', logger: { warn() {} }
  };
}

test('receiver accepts signed JSON', () => {
  const rawBody = '{"id":"delivery-1","payload":{"branch":"main"}}';
  const result = receiveWebhook(request(rawBody));
  assert.equal(result.status, 202);
  assert.equal(result.event.id, 'delivery-1');
});

test('receiver takes an id from the delivery header', () => {
  const rawBody = '{"payload":{"amount":4}}';
  const result = receiveWebhook(request(rawBody, { 'x-delivery-id': 'header-delivery' }));
  assert.equal(result.event.id, 'header-delivery');
});

import { validateWebhookShape, webhookSummary } from '../src/webhooks/receiver.js';

test('receiver reports malformed JSON', () => {
  assert.equal(validateWebhookShape('{').status, 400);
  assert.equal(validateWebhookShape('[]').body.error, 'invalid payload');
});

test('receiver summary exposes normalized fields', () => {
  const rawBody = '{"kind":"push","payload":{}}';
  const result = receiveWebhook(request(rawBody));
  assert.deepEqual(webhookSummary(result), { accepted: true, status: 202, provider: 'source', kind: 'push' });
});
