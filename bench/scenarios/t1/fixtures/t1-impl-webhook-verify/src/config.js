const defaults = require('../config/default.json');

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || defaults.port, 10);
  return {
    port: Number.isInteger(port) && port > 0 ? port : defaults.port,
    ledgerLabel: env.LEDGER_LABEL || defaults.ledgerLabel,
    maxBodyBytes: defaults.maxBodyBytes
  };
}

module.exports = { loadConfig };
