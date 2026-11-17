'use strict';

const config = require('../config/service.json');
const { createLookup } = require('./catalog');
const { createPricing } = require('./pricing');
const { createSearch } = require('./search');
const { domainSupplier, toItem } = require('./supplier/translate');
const { systemClock, realSleep } = require('./clock');
const { CatalogError } = require('./errors');

/**
 * The catalog service. `supplier` has `fetchItem(sku)` returning legacy records; `items` is the snapshot (legacy
 * records); `clock` and `sleep` replace the system clock and timer in tests.
 */
function createCatalogService({ supplier, items = [], clock = systemClock, sleep = realSleep }) {
  const lookup = createLookup({ supplier: domainSupplier(supplier), config, clock, sleep });
  const { priceLabel } = createPricing(lookup);
  const { listByCategory } = createSearch(Array.from(items, toItem));
  return { lookup, priceLabel, listByCategory };
}

module.exports = { createCatalogService, CatalogError };
