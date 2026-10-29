'use strict';

const { ValidationError } = require('./model');

const notFound = { status: 404, body: { error: { message: 'not found' } } };

function handleRequest(service, { method, path, query = {}, body = {} }) {
  try {
    if (method === 'POST' && path === '/contacts') return { status: 201, body: service.create(body) };
    if (method === 'GET' && path === '/contacts/export') return { status: 200, body: service.exportCsv() };
    if (method === 'GET' && path === '/contacts') {
      const contacts = query.q !== undefined ? service.search(query.q) : service.list({ sort: query.sort });
      return { status: 200, body: { contacts } };
    }
    const m = /^\/contacts\/([^/]+)$/.exec(path);
    if (m && method === 'GET') {
      const c = service.get(m[1]);
      return c ? { status: 200, body: c } : notFound;
    }
    if (m && method === 'PATCH') {
      const c = service.update(m[1], body);
      return c ? { status: 200, body: c } : notFound;
    }
    return notFound;
  } catch (e) {
    if (e instanceof ValidationError) return { status: 400, body: { error: { field: e.field, message: e.message } } };
    throw e;
  }
}

module.exports = { handleRequest };
