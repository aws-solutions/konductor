'use strict';

const { URL } = require('node:url');
const { badRequest, notFound } = require('../errors');
const { sendJson, sendError } = require('../http/response');
const { requestId } = require('../http/request-id');
const { createIssueHandlers } = require('./issues');
const { createCommentHandlers } = require('./comments');
const { createUserHandlers } = require('./users');

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw badRequest('Request body must be JSON'); }
}

function createRouter(store, config) {
  const issues = createIssueHandlers(store, config);
  const comments = createCommentHandlers(store);
  const users = createUserHandlers(store);

  return async function router(request, response) {
    const id = requestId(request);
    const url = new URL(request.url, 'http://trailhead.local');
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') return sendJson(response, 200, { ok: true }, id);
      if (!url.pathname.startsWith('/v1/')) throw notFound('Route not found');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[1] === 'issues' && parts.length === 2 && request.method === 'GET') {
        return sendJson(response, 200, issues.list(url.searchParams), id);
      }
      if (parts[1] === 'issues' && parts.length === 3 && request.method === 'GET') {
        return sendJson(response, 200, issues.get(parts[2]), id);
      }
      if (parts[1] === 'issues' && parts.length === 4 && parts[3] === 'comments' && request.method === 'GET') {
        return sendJson(response, 200, comments.list(parts[2]), id);
      }
      if (parts[1] === 'issues' && parts.length === 4 && parts[3] === 'comments' && request.method === 'POST') {
        return sendJson(response, 201, comments.create(parts[2], await readJson(request)), id);
      }
      if (parts[1] === 'users' && parts.length === 2 && request.method === 'GET') {
        return sendJson(response, 200, users.list(), id);
      }
      if (parts[1] === 'users' && parts.length === 3 && request.method === 'GET') {
        return sendJson(response, 200, users.get(parts[2]), id);
      }
      throw notFound('Route not found');
    } catch (error) {
      sendError(response, error, id);
    }
  };
}

module.exports = { createRouter };
