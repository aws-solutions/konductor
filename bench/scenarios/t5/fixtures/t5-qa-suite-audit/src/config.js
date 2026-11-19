'use strict';

const defaults = Object.freeze({
  currency: 'USD',
  invoiceDays: 14,
  retryLimit: 4,
  timezone: 'UTC'
});

function loadConfig(env = process.env) {
  return {
    currency: env.BILLING_CURRENCY || defaults.currency,
    invoiceDays: Number(env.INVOICE_DAYS || defaults.invoiceDays),
    retryLimit: Number(env.RETRY_LIMIT || defaults.retryLimit),
    timezone: env.BILLING_TIMEZONE || defaults.timezone
  };
}

module.exports = { defaults, loadConfig };
