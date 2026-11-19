'use strict';

const path = require('node:path');

function loadConfig(overrides = {}) {
  return {
    port: Number(overrides.port ?? process.env.RELAY_PORT ?? 8080),
    adminApiKey: overrides.adminApiKey ?? process.env.ADMIN_API_KEY ?? 'admin-example-key-not-for-use',
    retentionDays: Number(overrides.retentionDays ?? 30),
    eventDbPath: overrides.eventDbPath ?? process.env.EVENT_DB_PATH ?? path.join(process.cwd(), 'runtime', 'events.json'),
    delivery: {
      initialDelaySeconds: 5,
      maximumAttempts: 8
    }
  };
}

module.exports = { loadConfig };
