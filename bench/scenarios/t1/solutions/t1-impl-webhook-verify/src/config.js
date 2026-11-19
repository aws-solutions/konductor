const defaults = require('../config/default.json');

function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || defaults.port, 10);
  const tolerance = Number.parseInt(env.WEBHOOK_TOLERANCE_SECONDS || '300', 10);
  const webhookSecrets = [env.WEBHOOK_SECRET_PRIMARY, env.WEBHOOK_SECRET_SECONDARY]
    .filter((secret) => typeof secret === 'string' && secret.length > 0);
  return {
    port: Number.isInteger(port) && port > 0 ? port : defaults.port,
    ledgerLabel: env.LEDGER_LABEL || defaults.ledgerLabel,
    maxBodyBytes: defaults.maxBodyBytes,
    webhookSecrets,
    webhookToleranceSeconds: Number.isInteger(tolerance) && tolerance >= 0 ? tolerance : 300
  };
}

module.exports = { loadConfig };
