const { readConfig, withEnvironment } = require('./config');
const { Outbox } = require('./outbox');
const { RateLimiter } = require('./rate-limiter');
const { ReminderService } = require('./reminder-service');
const { createApi } = require('./api');

function createApplication(options = {}) {
  const config = withEnvironment({ ...readConfig(), ...options.config }, options.env || process.env);
  const outbox = options.outbox || new Outbox(config.outboxDirectory);
  const limiter = options.limiter || new RateLimiter(config.rateLimit.limit, config.rateLimit.windowMs);
  const service = new ReminderService({ outbox, limiter, timeZone: config.timeZone });
  return { config, outbox, limiter, service, api: createApi(service) };
}

module.exports = { createApplication };
