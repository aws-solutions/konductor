'use strict';

const { createLookup } = require('./catalog');
const { createPricing } = require('./pricing');
const { createSearch } = require('./search');
const { systemClock, realSleep } = require('./clock');
const { CatalogError } = require('./errors');

/**
 * The catalog service. `supplier` has `fetchItem(sku)`; `items` is the snapshot (legacy records); `clock` and `sleep`
 * replace the system clock and timer in tests.
 */
function createCatalogService({ supplier, items = [], clock = systemClock, sleep = realSleep }) {
  void clock;
  void sleep;
  const lookup = createLookup(supplier);
  const { priceLabel } = createPricing(supplier);
  const { listByCategory } = createSearch(items);
  return { lookup, priceLabel, listByCategory };
}

module.exports = { createCatalogService, CatalogError };
