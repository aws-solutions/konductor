const defaults = require('../config/default');
const production = require('../config/production');
const testConfig = require('../config/test');

function settingsFor(environment) {
  if (environment === 'production') return production;
  if (environment === 'test') return testConfig;
  return defaults;
}

function loadConfig(env = process.env) {
  const environment = env.NODE_ENV || 'development';
  const settings = settingsFor(environment);
  return {
    environment,
    host: env.HOST || settings.host,
    port: Number(env.PORT || settings.port),
    requestTimeoutMs: settings.requestTimeoutMs,
    retryLimit: settings.retryLimit,
    smsApiToken: env.SMS_API_TOKEN || null,
    databaseUrl: env.DATABASE_URL || settings.databaseUrl || null,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || null
  };
}

module.exports = { loadConfig };
