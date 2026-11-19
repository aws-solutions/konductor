'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRouter } = require('../src/api/router');
const { fixtureStore } = require('./test-fixtures');

function request(router, options, body = '') {
  return new Promise((resolve, reject) => {
    const server = http.createServer(router);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const req = http.request({ ...options, port: address.port, host: address.address }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { server.close(); resolve({ res, data }); });
      });
      req.on('error', reject);
      req.end(body);
    });
  });
}

test('health endpoint is available', async () => {
  const result = await request(createRouter(fixtureStore(), { defaultPageSize: 20, maxPageSize: 100 }), { method: 'GET', path: '/healthz' });
  assert.equal(result.res.statusCode, 200);
  assert.deepEqual(JSON.parse(result.data), { ok: true });
});
