'use strict';

/**
 * Least-recently-used cache with expiry. `ttlMs` is how long an entry stays fresh, `maxEntries` how many are kept,
 * and `clock.now()` gives the time in milliseconds. A Map keeps insertion order, so the first key is the oldest use.
 */
function createLruCache({ ttlMs, maxEntries, clock }) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      entries.delete(key);
      if (clock.now() - hit.at >= ttlMs) return undefined;
      entries.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, at: clock.now() });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
  };
}

module.exports = { createLruCache };
