'use strict';
const defaults = require('../config/defaults.json');
function number(env, key, fallback) { return env[key] === undefined ? fallback : Number(env[key]); }
function loadConfig(env = process.env) { return { ...defaults,
  port: number(env, 'HARBORLINE_PORT', defaults.port), statusEventsPublishBaseDelayMs: number(env, 'STATUS_EVENTS_PUBLISH_BASE_DELAY_MS', 1000),
  statusEventsPublishClaimMs: number(env, 'STATUS_EVENTS_PUBLISH_CLAIM_MS', 30000), statusEventsPublishMaxAttempts: number(env, 'STATUS_EVENTS_PUBLISH_MAX_ATTEMPTS', 5),
  statusEventsPublishConcurrency: number(env, 'STATUS_EVENTS_PUBLISH_CONCURRENCY', 4), statusEventsPublishTimeoutMs: number(env, 'STATUS_EVENTS_PUBLISH_TIMEOUT_MS', 250),
  statusEventsPublishEnabled: env.STATUS_EVENTS_PUBLISH_ENABLED === 'true'
}; }
module.exports = { loadConfig };
