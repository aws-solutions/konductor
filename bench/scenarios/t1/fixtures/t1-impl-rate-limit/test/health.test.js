const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, request } = require('./helpers');

test('health reports service status', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/health');
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'ok');
  });
});

test('ready returns a boolean', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/ready');
    assert.deepEqual(result.body, { ready: true });
  });
});
