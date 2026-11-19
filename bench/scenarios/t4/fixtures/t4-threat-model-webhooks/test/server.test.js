'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { server } = require('../prototype/server');

test('health endpoint reports service status', async () => {
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path: '/health' }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            assert.equal(response.statusCode, 200);
            assert.deepEqual(JSON.parse(body), { ok: true, service: 'harborline-relay' });
            server.close(resolve);
          } catch (error) {
            server.close(() => reject(error));
          }
        });
      }).on('error', (error) => server.close(() => reject(error)));
    });
  });
});
