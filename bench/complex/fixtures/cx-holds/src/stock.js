'use strict';

const { ServiceError } = require('./errors');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Calls yield once, like a datastore round trip. Each adjust is applied
// in one synchronous step after the yield, so it is atomic.
function createStock(initial = {}) {
  const levels = new Map(Object.entries(initial));

  const level = (sku) => {
    if (!levels.has(sku)) throw new ServiceError('unknown_sku', `unknown sku: ${sku}`, 404);
    return levels.get(sku);
  };

  return {
    async quantity(sku) {
      await tick();
      return level(sku);
    },
    async adjust(sku, delta) {
      await tick();
      const next = level(sku) + delta;
      if (next < 0) throw new ServiceError('insufficient_stock', `not enough stock for ${sku}`, 409);
      levels.set(sku, next);
      return next;
    },
  };
}

module.exports = { createStock };
