const http = require('node:http');
const { createExportHandler } = require('./export-route');
const { healthPayload } = require('./health');
const version = require('./version');
const { parsePort, toLine } = require('./format');

function requestHandler(req, res) {
  if (req.url === '/export' && req.method === 'GET') return createExportHandler()(req, res);
  if (req.url === '/health' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(healthPayload(version)));
    return;
  }
  res.statusCode = 404;
  res.end(toLine({ error: 'not found' }));
}

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(parsePort(process.env.PORT), () => process.stdout.write('northstar listening\n'));
}

module.exports = { requestHandler };
