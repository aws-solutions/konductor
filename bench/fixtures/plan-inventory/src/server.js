'use strict';

const http = require('node:http');
const config = require('./config');
const items = require('./handlers/items');

async function route(req, url, body) {
  const parts = url.pathname.split('/').filter(Boolean);
  const request = {
    params: {},
    query: Object.fromEntries(url.searchParams),
    body,
    headers: req.headers,
  };
  if (req.method === 'GET' && parts[0] === 'search') return items.search(request);
  if (req.method === 'GET' && parts[0] === 'reorder-report') return items.reorderReport(request);
  if (req.method === 'GET' && parts[0] === 'items' && parts[1]) {
    request.params.id = parts[1];
    return items.getItem(request);
  }
  if (req.method === 'POST' && parts[0] === 'items' && !parts[1]) return items.createItem(request);
  if (req.method === 'POST' && parts[0] === 'items' && parts[2] === 'stock') {
    request.params.id = parts[1];
    return items.adjustStock(request);
  }
  return { status: 404, body: { error: 'not found' } };
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function createServer() {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let body = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      } catch (err) {
        console.error('invalid JSON body:', err.message);
        return send(res, 400, { error: 'invalid JSON' });
      }
      try {
        const out = await route(req, new URL(req.url, 'http://localhost'), body);
        send(res, out.status, out.body);
      } catch (err) {
        send(res, 500, { error: err.message, stack: err.stack });
      }
    });
  });
}

if (require.main === module) {
  createServer().listen(config.port, config.host, () => {
    console.log(`listening on ${config.host}:${config.port}`);
  });
}

module.exports = { createServer, route };
