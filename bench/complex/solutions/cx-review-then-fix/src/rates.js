'use strict';

function createRateCache({ fetchRates, clock, ttlMs = 60000 }) {
  let rates = {};
  let updatedAt = null;

  async function refresh() {
    const fetched = await fetchRates();
    rates = fetched;
    updatedAt = clock.now();
  }

  async function get(currency) {
    if (updatedAt === null || clock.now() - updatedAt >= ttlMs) await refresh();
    if (!(currency in rates)) throw new Error(`unknown currency: ${currency}`);
    return rates[currency];
  }

  return { get, refresh, updatedAt: () => updatedAt };
}

module.exports = { createRateCache };
