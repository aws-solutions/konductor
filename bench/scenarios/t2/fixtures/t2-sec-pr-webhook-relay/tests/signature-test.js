import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureFor, validSignature, signatureParts } from '../src/webhooks/signatures.js';

test('signature helper accepts its own digest', () => {
  const body = '{"kind":"push"}';
  const provided = signatureFor('secret', body);
  assert.equal(validSignature('secret', body, provided), true);
  assert.equal(validSignature('wrong', body, provided), false);
});

test('signature parts preserve the scheme', () => {
  assert.deepEqual(signatureParts('sha256=abcd'), { scheme: 'sha256', value: 'abcd' });
});

test('signature helpers describe the envelope', () => {
  const header = 'sha256=' + 'a'.repeat(64);
  assert.equal(signatureParts(header).scheme, 'sha256');
  assert.equal((signatureParts(header).value || '').length, 64);
});
