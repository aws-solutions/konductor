const http = require('node:http');
const { loadConfig } = require('./config');
const { Ledger } = require('./ledger');
const { readBody } = require('./http');
const { route } = require('./router');
const { requestId } = require('./middleware/request-id');
const { logRequest } = require('./utils/log');
const { unixSeconds } = require('./utils/time');

function createServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const ledger = options.ledger || new Ledger(config.ledgerLabel);
  const secrets = options.secrets || config.webhookSecrets || [];
  const toleranceSeconds = options.toleranceSeconds ?? config.webhookToleranceSeconds ?? 300;
  const clock = options.clock || unixSeconds;
  return http.createServer((req, res) => {
    const id = requestId(req);
    res.on('finish', () => logRequest(id, req.method, req.url, res.statusCode));
    route({
      req, res, ledger, secrets, toleranceSeconds, clock,
      readBody: (request) => readBody(request, config.maxBodyBytes || 262144)
    });
  });
}

module.exports = { createServer };
