'use strict';

// In-memory counters. Keys are opaque strings.
function createStore() {
  const counts = new Map();
  return {
    get: (k) => counts.get(k) ?? 0,
    add(k, n = 1) {
      const v = (counts.get(k) ?? 0) + n;
      counts.set(k, v);
      return v;
    },
    delete: (k) => counts.delete(k),
    // Drops every counter whose key starts with the prefix.
    clear(prefix = '') {
      for (const k of [...counts.keys()]) if (k.startsWith(prefix)) counts.delete(k);
    },
    size: () => counts.size,
  };
}

module.exports = { createStore };
