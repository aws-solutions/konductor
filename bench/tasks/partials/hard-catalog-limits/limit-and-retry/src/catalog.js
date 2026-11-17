'use strict';

const config = require('../config/service.json');
const { createConcurrencyLimit } = require('./limit');
const { withRetry } = require('./retry');

function createLookup(supplier, sleep) {
  const limit = createConcurrencyLimit(config.supplier.maxInFlight);
  return async function lookup(sku) {
    let r;
    try {
      r = await withRetry(() => limit(() => supplier.fetchItem(sku)), { ...config.retry, sleep });
    } catch (err) {
      if (err.code === 'NOT_FOUND') return null;
      throw err;
    }
    return { sku: r.ITM_NO, name: r.DESC_TXT, priceCents: Number(r.PRC_CENTS), active: r.STAT === 'A', category: r.CAT_CD };
  };
}

module.exports = { createLookup };
