const defaults = require('../config/default.json');

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || defaults.port, 10);
  const toleranceSeconds = Number.parseInt(env.WEBHOOK_TOLERANCE_SECONDS || defaults.webhookToleranceSeconds, 10);
  return {
    port: Number.isInteger(port) && port > 0 ? port : defaults.port,
    ledgerLabel: env.LEDGER_LABEL || defaults.ledgerLabel,
    maxBodyBytes: defaults.maxBodyBytes,
    webhookSecrets: [env.WEBHOOK_SECRET_PRIMARY, env.WEBHOOK_SECRET_SECONDARY].filter((s) => typeof s === 'string' && s.length > 0),
    webhookToleranceSeconds: Number.isInteger(toleranceSeconds) && toleranceSeconds >= 0 ? toleranceSeconds : defaults.webhookToleranceSeconds
  };
}

module.exports = { loadConfig };
