'use strict';
function route(method, pathname) {
  if (method === 'GET' && pathname.startsWith('/returns/')) return 'get-return';
  if (method === 'POST' && pathname === '/returns') return 'create-return';
  return null;
}
module.exports = { route };
