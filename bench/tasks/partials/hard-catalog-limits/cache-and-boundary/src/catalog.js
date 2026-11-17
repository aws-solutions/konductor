'use strict';

const { createLruCache } = require('./cache');

function createLookup({ supplier, config, clock }) {
  const cache = createLruCache({ ...config.cache, clock });
  const pending = new Map();

  async function fetchFresh(sku) {
    try {
      const item = await supplier.fetchItem(sku);
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
    if (!pending.has(sku)) pending.set(sku, fetchFresh(sku).finally(() => pending.delete(sku)));
    return pending.get(sku);
  };
}

module.exports = { createLookup };
