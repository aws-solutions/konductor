'use strict';

// Shared key-value client. In production this talks to the managed key-value service that both API instances use;
// here it is an in-memory stand-in with the same calls. incr is atomic in the real service.
const store = new Map();
const expiries = new Map();

function sweep(key, now) {
  if (expiries.has(key) && expiries.get(key) <= now) {
    store.delete(key);
    expiries.delete(key);
  }
}

/** Adds 1 to a counter and returns the new value; the counter expires ttlMs after it is created. */
function incr(key, ttlMs, now = Date.now()) {
  sweep(key, now);
  const value = (store.get(key) || 0) + 1;
  store.set(key, value);
  if (!expiries.has(key)) expiries.set(key, now + ttlMs);
  return value;
}

/** Milliseconds until the key expires, or 0. */
function ttl(key, now = Date.now()) {
  sweep(key, now);
  return expiries.has(key) ? expiries.get(key) - now : 0;
}

module.exports = { incr, ttl };
