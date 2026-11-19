function ledgerHandler(ledger, _req, res) {
  const { sendJson } = require('../utils/json');
  sendJson(res, 200, ledger.snapshot());
}

module.exports = { ledgerHandler };
