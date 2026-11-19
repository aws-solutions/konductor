import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnce } from '../src/jobs/runner.js';

test('job runner retries a failed job', async () => {
  const store = { outbox: [{ type: 'send', payload: { id: 1 } }] };
  await assert.rejects(() => runOnce(store, { send: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(store.outbox[0].attempts, 1);
});
