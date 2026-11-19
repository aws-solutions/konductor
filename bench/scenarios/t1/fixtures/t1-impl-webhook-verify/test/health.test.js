const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server');
const { request, withServer } = require('./helpers');

test('health reports a ready service', async () => {
  await withServer(createServer(), async (server) => {
    const response = await request(server, { path: '/health' });
    assert.equal(response.status, 200);
  });
});
