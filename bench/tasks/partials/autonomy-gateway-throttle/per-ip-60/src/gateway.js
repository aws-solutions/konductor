'use strict';

const { normalize } = require('./request');
const { match } = require('./router');
const { ok, error } = require('./response');
const { HttpError } = require('./errors');
const { systemClock } = require('./clock');
const { createLogger } = require('./log');
const { createRateLimiter } = require('./ratelimit');

// Every caller is counted per address.
const keyOf = (request) => `ip:${request.ip}`;

function createGateway({ handlers = {}, clock = systemClock, logger = createLogger() } = {}) {
  const limiter = createRateLimiter({ clock, limit: 60 });

  function handle(raw) {
    const request = normalize(raw, clock);
    const verdict = limiter.check(keyOf(request));
    if (!verdict.allowed) {
      return { status: 429, body: { error: 'rate limit exceeded', retryAfterSec: verdict.retryAfterSec } };
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
