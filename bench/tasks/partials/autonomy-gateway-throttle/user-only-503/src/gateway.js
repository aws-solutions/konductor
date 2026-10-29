'use strict';

const { normalize } = require('./request');
const { match } = require('./router');
const { ok, error } = require('./response');
const { HttpError } = require('./errors');
const { systemClock } = require('./clock');
const { createLogger } = require('./log');
const { createRateLimiter } = require('./ratelimit');

// Only signed-in callers are limited.
const keyOf = (request) => (request.user !== null ? `user:${request.user}` : `ip:${request.ip}`);

function createGateway({ handlers = {}, clock = systemClock, logger = createLogger() } = {}) {
  const limiter = createRateLimiter({ clock });

  function handle(raw) {
    const request = normalize(raw, clock);
    const verdict = request.user === null ? { allowed: true } : limiter.check(keyOf(request));
    if (!verdict.allowed) {
      return { status: 503, body: { error: 'busy', retryAfterMs: verdict.retryAfterSec * 1000 } };
    }
    const route = match(handlers, request.method, request.path);
    if (!route) return error(404, 'not found');
    try {
      const body = route.handler(request, { params: route.params });
      logger.info('handled', { method: request.method, path: request.path });
      return ok(body);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message);
      logger.error('handler failed', { method: request.method, path: request.path, message: e.message });
      return error(500, 'internal error');
    }
  }
  return { handle };
}

module.exports = { createGateway };
