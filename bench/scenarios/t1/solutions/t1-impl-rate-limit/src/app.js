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
const { RateLimiter } = require('./rate-limiter');

function apiKeyFrom(request) {
  const primary = request.headers['x-api-key'];
  if (typeof primary === 'string' && primary.trim()) return primary.trim();
  const alternate = request.headers['x-booking-api-key'];
  if (typeof alternate === 'string' && alternate.trim()) return alternate.trim();
  return null;
}

function isExempt(request, pathname) {
  return request.method === 'GET' && (pathname === '/health' || pathname === '/ready');
}

function createApp(options = {}) {
  const config = options.config || loadConfig();
  const logger = options.logger || createLogger(config.logLevel);
  const store = options.store || new MemoryStore(config.seedFile);
  const service = new BookingService(store);
  const router = new Router();
  const handlers = bookings(service);
  registerRoutes(router, { health, ready, ...handlers });
  const limiter = config.rateLimit ? new RateLimiter(config.rateLimit, options.clock || Date.now) : null;

  return async function app(request, response) {
    const started = Date.now();
    const url = new URL(request.url, 'http://localhost');
    response.serviceName = config.serviceName;
    attachJson(response);
    requestId(request, response, () => {});

    try {
      const route = router.match(request.method, url.pathname);
      if (!route) throw new HttpError(404, 'not_found', 'Route was not found');
      if (limiter && !isExempt(request, url.pathname)) {
        const key = apiKeyFrom(request);
        if (!key) {
          response.json(401, { error: { code: 'missing_api_key', message: 'API key is required' } });
          return;
        }
        const result = limiter.check(key);
        response.setHeader('RateLimit-Limit', String(result.limit));
        response.setHeader('RateLimit-Remaining', String(result.remaining));
        if (!result.allowed) {
          response.setHeader('Retry-After', String(result.retryAfter));
          response.json(429, { error: { code: 'rate_limit_exceeded', message: 'Request limit exceeded' } });
          return;
        }
      }
      request.params = route.params;
      request.body = await readJson(request);
      await route.handler(request, response);
    } catch (error) {
      if (response.headersSent) return;
      const status = error instanceof HttpError ? error.status : 400;
      const code = error instanceof HttpError ? error.code : 'bad_request';
      response.json(status, { error: { code, message: error.message } });
    } finally {
      logger.info('request.complete', { method: request.method, path: url.pathname, status: response.statusCode, durationMs: Date.now() - started });
    }
  };
}

module.exports = { createApp, apiKeyFrom };
