'use strict';

const { createLookup } = require('./catalog');
const { createPricing } = require('./pricing');
const { createSearch } = require('./search');
const { systemClock, realSleep } = require('./clock');
const { CatalogError } = require('./errors');

function createCatalogService({ supplier, items = [], clock = systemClock, sleep = realSleep }) {
  void clock;
  const lookup = createLookup(supplier, sleep);
  const { priceLabel } = createPricing(supplier);
  const { listByCategory } = createSearch(items);
  return { lookup, priceLabel, listByCategory };
}

module.exports = { createCatalogService, CatalogError };
