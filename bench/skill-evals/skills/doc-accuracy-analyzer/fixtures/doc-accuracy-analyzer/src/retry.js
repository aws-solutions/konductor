'use strict';

// TODO: add exponential backoff. For now we try exactly once.
async function withRetry(fn) {
  return fn();
}

module.exports = { withRetry };
