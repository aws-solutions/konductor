'use strict';

/** A setting that is missing or out of range. `code` is CONFIG and the message names the variable. */
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.code = 'CONFIG';
  }
}

/** The integer in `env[name]` from `min` to `max`, or `fallback` when the variable is not set. */
function intSetting(env, name, { min, max, fallback }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(String(raw))) throw new ConfigError(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
  const value = Number(raw);
  if (value < min || value > max) throw new ConfigError(`${name} must be from ${min} to ${max}, got ${value}`);
  return value;
}

/** Every worker setting, read and checked once. `env` is the environment to read (process.env in production). */
function loadConfig(env) {
  const apiKey = env.WORKER_API_KEY;
  if (!apiKey) throw new ConfigError('WORKER_API_KEY is required');
  return {
    apiKey,
    concurrency: intSetting(env, 'WORKER_CONCURRENCY', { min: 1, max: 16, fallback: 2 }),
    drainMs: intSetting(env, 'WORKER_DRAIN_MS', { min: 0, max: 60000, fallback: 5000 }),
  };
}

module.exports = { ConfigError, loadConfig };
