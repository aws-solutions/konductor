'use strict';

// Calls fn until it returns without throwing, at most `attempts` times, waiting `delayMs` between tries.
async function withRetry(fn, { attempts, delayMs }, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastError;
}

module.exports = { withRetry };
