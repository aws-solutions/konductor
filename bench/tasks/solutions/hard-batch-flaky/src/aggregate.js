'use strict';

// Per-customer totals in cents.
function createAggregator(base = {}) {
  return {
    add(event) {
      base[event.customerId] = (base[event.customerId] ?? 0) + event.amountCents;
    },
    totals: () => base,
  };
}

module.exports = { createAggregator };
