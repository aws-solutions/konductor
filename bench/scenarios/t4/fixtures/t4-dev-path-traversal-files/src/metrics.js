'use strict';

function createMetrics() {
  const values = new Map();
  return {
    increment(name, amount = 1) { values.set(name, (values.get(name) || 0) + amount); },
    snapshot() { return Object.fromEntries(values); }
  };
}

module.exports = { createMetrics };
