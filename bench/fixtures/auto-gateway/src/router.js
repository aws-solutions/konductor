'use strict';

function compile(pattern) {
  const [method, path] = pattern.split(' ');
  const names = [];
  const source = path.replace(/:([A-Za-z_]+)/g, (_, name) => { names.push(name); return '([^/]+)'; });
  return { method, re: new RegExp(`^${source}$`), names };
}

// handlers: { 'GET /items/:id': fn }. Returns { handler, params } or null.
function match(handlers, method, path) {
  for (const [pattern, handler] of Object.entries(handlers)) {
    const route = compile(pattern);
    if (route.method !== method) continue;
    const m = route.re.exec(path);
    if (!m) continue;
    const params = {};
    route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    return { handler, params };
  }
  return null;
}

module.exports = { match };
