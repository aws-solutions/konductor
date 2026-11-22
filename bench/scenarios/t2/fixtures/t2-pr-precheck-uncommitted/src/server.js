'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');
const { createQuoteService } = require('./quote');
const { createLogger } = require('./logger');

function startServer({ config = loadConfig(), service, logger = createLogger() } = {}) {
  const quoteService = service || createQuoteService({ config, logger });
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/quote') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const result = await quoteService.quote(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  });
  server.listen(config.port, () => logger.info('quote server listening', { port: config.port }));
  return server;
}

if (require.main === module) startServer();
module.exports = { startServer };
