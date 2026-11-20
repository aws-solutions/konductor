'use strict';
const http = require('node:http');
const { route } = require('./router');
function createServer(handler) {
  return http.createServer((req, res) => {
    const action = route(req.method, req.url);
    if (!action) { res.statusCode = 404; return res.end(); }
    handler(action, req, res);
  });
}
module.exports = { createServer };
