const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpServer } = require('../src/http');

test('health endpoint responds', async () => {
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
