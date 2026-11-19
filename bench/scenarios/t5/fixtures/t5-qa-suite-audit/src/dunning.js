'use strict';

const { ValidationError } = require('./errors');

const RETRY_DELAYS_HOURS = Object.freeze([1, 12, 48, 120]);

function nextAttempt(attempts, limit = RETRY_DELAYS_HOURS.length) {
  if (!Number.isInteger(attempts) || attempts < 0) throw new ValidationError('attempt count is invalid');
  if (attempts >= limit || attempts >= RETRY_DELAYS_HOURS.length) return null;
  return { attempt: attempts + 1, delayHours: RETRY_DELAYS_HOURS[attempts] };
}

function shouldRetry(result) {
  return Boolean(result && result.status === 'failed' && result.retryable === true);
}

function recordFailure(invoice, result) {
  if (!shouldRetry(result)) return { ...invoice, status: 'past_due', lastFailure: result?.code || 'unknown' };
  const retry = nextAttempt(invoice.attempts || 0);
  return { ...invoice, status: retry ? 'retrying' : 'past_due', attempts: retry ? retry.attempt : invoice.attempts, lastFailure: result.code };
}

module.exports = { RETRY_DELAYS_HOURS, nextAttempt, shouldRetry, recordFailure };
