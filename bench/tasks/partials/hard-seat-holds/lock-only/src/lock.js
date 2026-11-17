'use strict';

/**
 * Per-key mutual exclusion inside one process. `withLock(key, fn)` runs `fn` after every earlier call for the same
 * key has finished, and returns what `fn` returns. Calls for different keys do not wait for each other.
 */
function createKeyedLock() {
  const tails = new Map();
  return async function withLock(key, fn) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

module.exports = { createKeyedLock };
