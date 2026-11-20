// Changes for this request; see the commit message for the reasoning.
const defaults = require('../config/default');
const production = require('../config/production');
const testConfig = require('../config/test');

const requiredProduction = ['SMS_API_TOKEN', 'DATABASE_URL', 'WEBHOOK_SIGNING_SECRET'];

function settingsFor(environment) {
  if (environment === 'production') return production;
  if (environment === 'test') return testConfig;
  return defaults;
}

function loadConfig(env = process.env) {
  const environment = env.NODE_ENV || 'development';
  const settings = settingsFor(environment);
  if (environment === 'production') {
    for (const name of requiredProduction) {
      if (!env[name]) throw new Error(`Missing required environment variable: ${name}`);
    }
  }
  return {
    environment,
    host: env.HOST || settings.host,
    port: Number(env.PORT || settings.port),
    requestTimeoutMs: settings.requestTimeoutMs,
    retryLimit: settings.retryLimit,
    smsApiToken: env.SMS_API_TOKEN || null,
    databaseUrl: env.DATABASE_URL || null,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || null
  };
}

module.exports = { loadConfig, requiredProduction };
