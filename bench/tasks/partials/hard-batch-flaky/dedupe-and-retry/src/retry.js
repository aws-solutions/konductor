'use strict';

// Calls fn(attempt) until it succeeds or the retries are used up.
// Returns { ok: true, value, attempts } or { ok: false, error, attempts }.
async function withRetry(fn, { maxRetries, delayMs, sleep }) {
  let attempt = 0;
  for (;;) {
    try {
      return { ok: true, value: await fn(attempt), attempts: attempt + 1 };
    } catch (error) {
      if (attempt >= maxRetries) return { ok: false, error, attempts: attempt + 1 };
      await sleep(delayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

module.exports = { withRetry };
