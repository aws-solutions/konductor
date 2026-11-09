'use strict';

const http = require('node:http');
const { ServiceError } = require('./errors');

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        return reject(new ServiceError('invalid_request', 'body is not valid JSON', 400));
      }
    });
  });
}

function compile(pattern) {
  const names = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  return { re: new RegExp(`^${source}$`), names };
}

// routes: [{ method, path, handler({ params, body }) -> { status?, body } }]
function createRoutedServer(routes) {
  const compiled = routes.map((route) => ({ ...route, ...compile(route.path) }));

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const route = compiled.find((r) => r.method === req.method && r.re.test(pathname));
      if (!route) throw new ServiceError('not_found', 'no such route', 404);
      const match = route.re.exec(pathname);
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
      const result = await route.handler({ params, body });
      send(result.status || 200, result.body);
    } catch (err) {
      if (err instanceof ServiceError) return send(err.status, { error: { code: err.code, message: err.message } });
      return send(500, { error: { code: 'internal', message: 'internal error' } });
    }
  });
}

module.exports = { createRoutedServer };
