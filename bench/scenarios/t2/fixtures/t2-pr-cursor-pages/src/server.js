'use strict';

const http = require('node:http');
const { readConfig } = require('./config');
const { createStore } = require('./store/store-factory');
const { createRouter } = require('./api/router');
const { logRequest } = require('./log');

function createServer(config = readConfig()) {
  const store = createStore(config);
  const router = createRouter(store, config);
  return http.createServer((request, response) => {
    router(request, response).finally(() => {
      if (!response.writableEnded) response.end();
      logRequest(request.method, request.url, response.statusCode, response.getHeader('x-request-id'));
    });
  });
}

if (require.main === module) {
  const config = readConfig();
  createServer(config).listen(config.port, config.host, () => {
    console.log(`Trailhead listening on http://${config.host}:${config.port}`);
  });
}

module.exports = { createServer };
