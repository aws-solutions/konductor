'use strict';

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

function shouldRetry(statusCode, retryOn) {
  const statuses = Array.isArray(retryOn) ? retryOn : DEFAULT_RETRY_STATUSES;
  return statuses.includes(statusCode);
}

function parseRetryAfter(value, fallbackMs) {
  if (value == null || value.trim() === '') return fallbackMs;
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return number * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return fallbackMs;
}

module.exports = { DEFAULT_RETRY_STATUSES, shouldRetry, parseRetryAfter };
