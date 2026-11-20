'use strict';

const entries = new Map();

function get(key, now = Date.now()) {
  const item = entries.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= now) {
    entries.delete(key);
    return undefined;
  }
  return item.value;
}

function set(key, value, ttlMs, now = Date.now()) {
  entries.set(key, { value, expiresAt: now + ttlMs });
}

function clear() {
  entries.clear();
}

module.exports = { get, set, clear };
