const { URL } = require('node:url');
const { loadConfig } = require('./config');
const { Router } = require('./router');
const { HttpError } = require('./errors');
const { createLogger } = require('./logger');
const { MemoryStore } = require('./store/memory-store');
const { BookingService } = require('./services/booking-service');
const { bookings } = require('./handlers/bookings');
const { health, ready } = require('./handlers/health');
const { registerRoutes } = require('./routes');
const { requestId } = require('./middleware/request-id');
const { readJson } = require('./middleware/body');
const { attachJson } = require('./response');
const { rateLimit } = require('./middleware/rate-limit');

function createApp(options = {}) {
  const config = options.config || loadConfig();
  const clock = options.clock || (() => Date.now());
  const logger = options.logger || createLogger(config.logLevel);
  const store = options.store || new MemoryStore(config.seedFile);
  const service = new BookingService(store);
  const router = new Router();
  const handlers = bookings(service);
  registerRoutes(router, { health, ready, ...handlers });
  const limiter = rateLimit(config, clock);

  return async function app(request, response) {
    const started = Date.now();
    const url = new URL(request.url, 'http://localhost');
    response.serviceName = config.serviceName;
    attachJson(response);
    requestId(request, response, () => {});

    try {
      const route = router.match(request.method, url.pathname);
      if (!route) throw new HttpError(404, 'not_found', 'Route was not found');
      request.params = route.params;
      request.body = await readJson(request);

      const isHealthOrReady = url.pathname === '/health' || url.pathname === '/ready';
      if (!isHealthOrReady) {
        let called = false;
        await new Promise(resolve => {
          limiter(request, response, () => {
            called = true;
            resolve();
          });
        });
        if (!called) return;
      }

      await route.handler(request, response);
    } catch (error) {
      if (response.headersSent) return;
      const status = error instanceof HttpError ? error.status : 400;
      const code = error instanceof HttpError ? error.code : 'bad_request';
      const message = error instanceof HttpError ? error.message : error.message;
      response.json(status, { error: { code, message } });
    } finally {
      logger.info('request.complete', { method: request.method, path: url.pathname, status: response.statusCode, durationMs: Date.now() - started });
    }
  };
}

module.exports = { createApp };
