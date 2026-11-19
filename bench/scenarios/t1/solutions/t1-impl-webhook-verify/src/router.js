const { health } = require('./handlers/health');
const { ledgerHandler } = require('./handlers/ledger');
const { webhookHandler } = require('./handlers/webhook');
const { sendJson } = require('./utils/json');

function route({ req, res, ledger, readBody, secrets, toleranceSeconds, clock }) {
  if (req.method === 'GET' && req.url === '/health') return health(req, res);
  if (req.method === 'GET' && req.url === '/ledger') return ledgerHandler(ledger, req, res);
  if (req.method === 'POST' && req.url === '/webhooks/payment') {
    return webhookHandler({ req, res, ledger, readBody, secrets, toleranceSeconds, clock });
  }
  return sendJson(res, 404, { error: 'not_found' });
}

module.exports = { route };
