'use strict';

function headerValue(headers, name) {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function createHttpClient(options = {}) {
  if (typeof options.transport !== 'function') throw new TypeError('transport is required');
  const transport = options.transport;
  const clock = options.clock || {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const retryStatuses = new Set(options.retryStatuses || [429, 502, 503, 504]);
  const breakerFailureThreshold = options.breakerFailureThreshold ?? 5;
  const breakerCooldownMs = options.breakerCooldownMs ?? 30000;
  const limiter = options.limiter || null;
  let consecutiveFailures = 0;
  let breakerOpenedAt = null;

  function sleep(ms) {
    return new Promise((resolve) => clock.setTimeout(resolve, Math.max(0, ms)));
  }

  function breakerAllows() {
    if (breakerOpenedAt === null) return true;
    if (clock.now() - breakerOpenedAt >= breakerCooldownMs) {
      breakerOpenedAt = null;
      consecutiveFailures = 0;
      return true;
    }
    return false;
  }

  function noteSuccess() {
    consecutiveFailures = 0;
  }

  function noteFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= breakerFailureThreshold) breakerOpenedAt = clock.now();
  }

  function retryAfterMs(response) {
    const value = headerValue(response.headers, 'retry-after');
    if (value === undefined) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, date - clock.now());
    return null;
  }

  function backoffMs(attempt, response) {
    const serverDelay = retryAfterMs(response);
    if (serverDelay !== null) return Math.min(maxDelayMs, serverDelay);
    const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
    const jitter = exponential * jitterRatio * (random() * 2 - 1);
    return Math.max(0, Math.round(exponential + jitter));
  }

  async function request(input) {
    if (!input || typeof input !== 'object') throw new TypeError('request input is required');
    if (!breakerAllows()) {
      const error = new Error('partner circuit is open');
      error.code = 'CIRCUIT_OPEN';
      throw error;
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (limiter && typeof limiter.take === 'function') await limiter.take(clock);
      const response = await transport(input, { attempt });
      const retryable = retryStatuses.has(response.status);
      if (!retryable) {
        if (response.status >= 200 && response.status < 500) noteSuccess();
        else noteFailure();
        return response;
      }
      noteFailure();
      if (attempt === maxAttempts) return response;
      await sleep(backoffMs(attempt, response));
    }
    throw new Error('unreachable');
  }

  return { request };
}

module.exports = { createHttpClient };
