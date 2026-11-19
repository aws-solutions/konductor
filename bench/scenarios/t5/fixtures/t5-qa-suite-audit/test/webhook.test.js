'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { signatureFor, verifySignature, parseEvent, applyEvent } = require('../src/webhooks');
const { InMemoryRepository } = require('../src/repository');

test('webhook signatures validate the exact payload', () => {
  const raw = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
  const signature = signatureFor(raw, 'secret');
  assert.equal(verifySignature(raw, signature, 'secret'), true);
  assert.equal(verifySignature(raw + ' ', signature, 'secret'), false);
});

test('payload parser rejects an invalid signature', () => assert.throws(() => parseEvent('{}', 'bad', 'secret'), /signature/));

test('event application is idempotent', () => {
  const repo = new InMemoryRepository();
  const event = { id: 'evt_2', type: 'invoice.paid' };
  assert.deepEqual(applyEvent(event, repo), { applied: true, duplicate: false, type: 'invoice.paid' });
  assert.deepEqual(applyEvent(event, repo), { applied: false, duplicate: true });
});
