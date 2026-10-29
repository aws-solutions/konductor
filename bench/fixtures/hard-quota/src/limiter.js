'use strict';

const { systemClock } = require('./clock');
const { createStore } = require('./store');
const { normalizeKey } = require('./keys');

// Fixed-window counter per key. Windows are aligned to multiples of windowSec since the epoch.
function createLimiter({ limit, windowSec = 60, clock = systemClock, store = createStore() } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  const span = windowSec * 1000;
  return {
    check(key) {
      const now = clock.now();
      const start = now - (now % span);
      const id = `${normalizeKey(key)}|${start}`;
      if (store.get(id) >= limit) return { allowed: false, remaining: 0, resetAt: start + span };
      const used = store.add(id, 1);
      return { allowed: true, remaining: limit - used, resetAt: start + span };
    },
  };
}

module.exports = { createLimiter };
