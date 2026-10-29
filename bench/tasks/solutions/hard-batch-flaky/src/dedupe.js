'use strict';

const { defaults } = require('./config');

const systemClock = { now: () => Date.now() };

// Remembers which event ids were handled, for ttlMs.
function createDedupeStore({ clock = systemClock, ttlMs = defaults.dedupeTtlMs } = {}) {
  const seen = new Map();
  const prune = () => {
    const now = clock.now();
    for (const [id, at] of seen) if (now - at >= ttlMs) seen.delete(id);
  };
  return {
    has(id) {
      prune();
      return seen.has(id);
    },
    mark(id) {
      prune();
      seen.set(id, clock.now());
    },
    forget: (id) => seen.delete(id),
    size: () => seen.size,
  };
}

module.exports = { createDedupeStore };
