import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../src/webhooks/normalize.js';

test('normalizer keeps provider and payload', () => {
  const result = normalizeEvent('source', { id: 'd1', kind: 'push', payload: { branch: 'main' } });
  assert.equal(result.provider, 'source');
  assert.deepEqual(result.payload, { branch: 'main' });
});
