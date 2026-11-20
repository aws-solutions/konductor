'use strict';
const routes = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/v1/accounts/:accountId' },
  { method: 'POST', path: '/v1/accounts/:accountId/projects' },
  { method: 'GET', path: '/v1/accounts/:accountId/projects' },
  { method: 'GET', path: '/v1/accounts/:accountId/projects/limit' },
  { method: 'POST', path: '/v1/accounts/:accountId/projects/batch' },
  { method: 'POST', path: '/v1/accounts/:accountId/project-limit-override' },
  { method: 'POST', path: '/v1/accounts/:accountId/members/invite' }
];
function matchPath(pattern, actual) { const a = pattern.split('/'), b = actual.split('/'); if (a.length !== b.length) return null; const params = {}; for (let i=0;i<a.length;i++) { if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]); else if (a[i] !== b[i]) return null; } return params; }
function makeRouter(handlers) { return async function route(method, url, body) { for (const r of routes) { const params = matchPath(r.path, url.split('?')[0]); if (r.method === method && params) return handlers[`${method} ${r.path}`](params, body); } return { status: 404, body: { error: { code: 'route_not_found', message: 'route not found' } } }; }; }
module.exports = { routes, matchPath, makeRouter };
