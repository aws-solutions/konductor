'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../src/server');

test('returns not found for an unknown path', async () => {
  const server = startServer({ config: { port: 0 }, service: { quote: async () => ({}) }, logger: { info() {} } });
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 404);
  server.close();
});
