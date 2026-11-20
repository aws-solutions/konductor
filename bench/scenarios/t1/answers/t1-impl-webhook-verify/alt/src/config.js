const defaults = require('../config/default.json');

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || defaults.port, 10);
  const toleranceSeconds = Number.parseInt(env.WEBHOOK_TOLERANCE_SECONDS || defaults.webhookToleranceSeconds, 10);
  return {
    port: Number.isInteger(port) && port > 0 ? port : defaults.port,
    ledgerLabel: env.LEDGER_LABEL || defaults.ledgerLabel,
    maxBodyBytes: defaults.maxBodyBytes,
    secrets: {
      primary: env.WEBHOOK_SECRET_PRIMARY || null,
      secondary: env.WEBHOOK_SECRET_SECONDARY || null
    },
    toleranceSeconds: Number.isInteger(toleranceSeconds) && toleranceSeconds >= 0 ? toleranceSeconds : defaults.webhookToleranceSeconds
  };
}

module.exports = { loadConfig };
