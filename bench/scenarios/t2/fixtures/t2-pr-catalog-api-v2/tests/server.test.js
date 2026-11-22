import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http/server.js';

test('health endpoint returns ok', async (t) => {
  const server = createServer().listen(0);
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('missing routes return not found', async (t) => {
  const server = createServer().listen(0);
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/v2/nope`);
  assert.equal(response.status, 404);
});
