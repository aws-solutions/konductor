'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server');

async function call(server, path, { method = 'GET', key, body } = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(key ? { 'x-api-key': key } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('notes API: health, auth, create and list', async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    assert.equal((await call(server, '/health')).status, 200);
    assert.equal((await call(server, '/v1/notes')).status, 401);
    assert.equal((await call(server, '/v1/notes', { method: 'POST', key: 'qb_free_7f2c', body: { text: 'hi' } })).status, 201);
    const list = await call(server, '/v1/notes', { key: 'qb_free_7f2c' });
    assert.deepEqual(list.body.notes.map((n) => n.text), ['hi']);
  } finally {
    server.close();
  }
});
