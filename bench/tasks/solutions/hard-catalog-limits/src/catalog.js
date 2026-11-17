'use strict';

const { createLruCache } = require('./cache');
const { createConcurrencyLimit } = require('./limit');
const { withRetry } = require('./retry');

/**
 * `lookup(sku)`: the domain item, or null when the supplier does not know the SKU. `supplier` already returns
 * domain items; `config` holds the limits of config/service.json; `clock` and `sleep` drive expiry and back-off.
 */
function createLookup({ supplier, config, clock, sleep }) {
  const cache = createLruCache({ ...config.cache, clock });
  const limit = createConcurrencyLimit(config.supplier.maxInFlight);
  const pending = new Map();

  async function fetchFresh(sku) {
    try {
      const item = await withRetry(() => limit(() => supplier.fetchItem(sku)), { ...config.retry, sleep });
      cache.set(sku, item);
      return item;
    } catch (err) {
      if (err.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  return function lookup(sku) {
    const hit = cache.get(sku);
    if (hit) return Promise.resolve(hit);
    // Callers that ask for one SKU at once share the call in flight (NFR-1).
    if (!pending.has(sku)) pending.set(sku, fetchFresh(sku).finally(() => pending.delete(sku)));
    return pending.get(sku);
  };
}

module.exports = { createLookup };
