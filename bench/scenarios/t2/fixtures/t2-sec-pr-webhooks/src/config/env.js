/**
 * Environment configuration
 */

export const ENV = {
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'dev_default_secret_123',
  PORT: parseInt(process.env.PORT || '3000', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ALLOWED_CALLBACK_DOMAINS: (process.env.ALLOWED_CALLBACK_DOMAINS || '').split(',').filter(Boolean),
  MAX_CALLBACK_TIMEOUT_MS: parseInt(process.env.MAX_CALLBACK_TIMEOUT_MS || '10000', 10)
};