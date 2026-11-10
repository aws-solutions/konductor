'use strict';

const MAX_ATTEMPTS = 3;

async function runWithRetries(job) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await job();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = { runWithRetries, MAX_ATTEMPTS };
