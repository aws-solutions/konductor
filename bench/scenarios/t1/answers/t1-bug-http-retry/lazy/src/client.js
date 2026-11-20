'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const cache = require('./cache');
const { normaliseHeaders } = require('./headers');
const { shouldRetry, parseRetryAfter } = require('./retry');

const realTimers = { setTimeout, clearTimeout };

function makeTimeoutError() {
  const error = new Error('request timed out');
  error.code = 'ETIMEDOUT';
  return error;
}

function makeRequestError(message, cause) {
  const error = new Error(message);
  if (cause) error.cause = cause;
  return error;
}

function request(input, options = {}) {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();
  const headers = normaliseHeaders(options.headers || {});
  const body = options.body == null ? null : options.body;
  const retries = Number.isInteger(options.retries) && options.retries > 0 ? options.retries : 0;
  const maxAttempts = retries > 0 ? retries : 1;
  const retryOn = options.retryOn;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1000;
  const fallbackDelay = Number.isFinite(options.retryDelayMs) ? Math.max(0, options.retryDelayMs) : 100;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const logger = typeof options.logger === 'function' ? options.logger : null;
  const timerApi = options.timers || realTimers;
  const canCache = method === 'GET' && Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs > 0;
  const cacheKey = `${method} ${url.href}`;

  if (canCache) {
    const cached = cache.get(cacheKey);
    if (cached) return Promise.resolve({ ...cached, fromCache: true, attempts: 0 });
  }

  return (async () => {
    let lastError;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      logger?.({ type: 'attempt', method, url: url.href, attempt });
      try {
        const response = await performAttempt(url, method, headers, body, timeoutMs, timerApi);
        if (shouldRetry(response.statusCode, retryOn) && attempt < maxAttempts) {
          const delay = parseRetryAfter(response.headers['retry-after'], fallbackDelay);
          logger?.({ type: 'retry', method, url: url.href, attempt, delay });
          await sleep(delay);
          continue;
        }
        const result = { ...response, attempts: attempt, url: url.href };
        if (canCache && response.statusCode >= 200 && response.statusCode < 300) {
          cache.set(cacheKey, result, options.cacheTtlMs);
        }
        logger?.({ type: 'complete', method, url: url.href, attempt, statusCode: result.statusCode });
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) throw error;
        logger?.({ type: 'retry-error', method, url: url.href, attempt, code: error.code });
        await sleep(fallbackDelay);
      }
    }
    throw lastError || makeRequestError('request failed');
  })();
}

function performAttempt(url, method, headers, body, timeoutMs, timerApi) {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('error', fail);
      res.on('end', () => {
        settled = true;
        resolve({ statusCode: res.statusCode, headers: normaliseHeaders(res.headers), body: Buffer.concat(chunks).toString('utf8') });
      });
    });

    function fail(error) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) timerApi.clearTimeout(timer);
      reject(error);
    }

    req.on('error', (error) => fail(error));
    timer = timerApi.setTimeout(() => {
      const error = makeTimeoutError();
      req.destroy(error);
      fail(error);
    }, timeoutMs);

    if (body != null) {
      req.write(body);
    }
    req.end();
  });
}

module.exports = { request, makeTimeoutError };
