const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpHandler } = require('../src/http-handler');

test('http handler writes an accepted response', async () => {
  const response = { statusCode: 0, body: '', end(value) { this.body = value; } };
  const worker = { accept: async () => ({ status: 'processed' }) };
  await createHttpHandler(worker)({ body: {} }, response);
  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { status: 'processed' });
});
