const fs = require('node:fs');
const path = require('node:path');

function readConfig(file = path.join(__dirname, '..', 'config', 'default.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function withEnvironment(config, env = process.env) {
  return {
    ...config,
    timeZone: env.REMINDER_TIME_ZONE || config.timeZone,
    outboxDirectory: env.REMINDER_OUTBOX || config.outboxDirectory,
    rateLimit: { ...config.rateLimit, limit: env.REMINDER_RATE_LIMIT ? Number(env.REMINDER_RATE_LIMIT) : config.rateLimit.limit }
  };
}

module.exports = { readConfig, withEnvironment };
