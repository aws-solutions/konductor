const http = require('node:http');
const { loadConfig } = require('./config');
const { Ledger } = require('./ledger');
const { readBody } = require('./http');
const { route } = require('./router');
const { requestId } = require('./middleware/request-id');
const { logRequest } = require('./utils/log');

function createServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const ledger = options.ledger || new Ledger(config.ledgerLabel);
  return http.createServer((req, res) => {
    const id = requestId(req);
    res.on('finish', () => logRequest(id, req.method, req.url, res.statusCode));
    route({ req, res, ledger, readBody: (request) => readBody(request, config.maxBodyBytes) });
  });
}

module.exports = { createServer };
