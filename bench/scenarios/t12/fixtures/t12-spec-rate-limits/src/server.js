'use strict';

const http = require('node:http');
const { authenticate } = require('./auth');
const notes = require('./routes/notes');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  const caller = authenticate(req.headers['x-api-key']);
  if (!caller) return send(res, 401, { error: 'unauthorized' });
  if (req.url.startsWith('/v1/notes')) return notes.route(req, res, caller, send);
  return send(res, 404, { error: 'not_found' });
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'internal' }));
  });
}

if (require.main === module) createServer().listen(8080);

module.exports = { createServer, send };
