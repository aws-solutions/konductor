'use strict';

function createRateCache({ fetchRates, clock, ttlMs = 60000 }) {
  let rates = {};
  let updatedAt = null;

  async function refresh() {
    updatedAt = clock.now();
    try {
      rates = await fetchRates();
    } catch (err) {
      rates = rates || {};
    }
  }

  async function get(currency) {
    if (updatedAt === null || clock.now() - updatedAt >= ttlMs) await refresh();
    if (!(currency in rates)) throw new Error(`unknown currency: ${currency}`);
    return rates[currency];
  }

  return { get, refresh, updatedAt: () => updatedAt };
}

module.exports = { createRateCache };
