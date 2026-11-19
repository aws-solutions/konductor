'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');

const config = loadConfig();
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'harborline-relay' }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

if (require.main === module) {
  server.listen(config.port, () => console.log(`relay listening on ${config.port}`));
}

module.exports = { server };
