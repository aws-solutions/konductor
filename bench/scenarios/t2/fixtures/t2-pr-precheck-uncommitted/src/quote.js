'use strict';

const { validateShipment } = require('./validation');
const { localRate } = require('./rates');
const { requestRate } = require('./carrier');
const { QuoteCache } = require('./cache');

function cacheKey(shipment) {
  return [
    shipment.origin.country,
    shipment.origin.postalCode,
    shipment.destination.postalCode,
    shipment.weightKg
  ].join(':');
}

function quoteResult(rate, cached = false) {
  return { total: rate.amount, currency: rate.currency, source: rate.source, cached };
}

function unavailableQuote(currency = 'USD') {
  return { total: 0, currency, source: 'carrier-unavailable', cached: false };
}

function isRateUsable(rate) {
  return rate && Number.isFinite(rate.amount) && rate.amount >= 0 && typeof rate.currency === 'string';
}

function quoteCurrency(config) {
  return config.currency || 'USD';
}

function cacheResult(cache, key, rate) {
  const result = quoteResult(rate);
  cache.set(key, result);
  return result;
}

function createQuoteService({ config, cache = new QuoteCache(config.cacheTtlMs), carrier = requestRate, logger = console, metrics = null }) {
  async function quote(shipment) {
    validateShipment(shipment);
    const key = cacheKey(shipment);
    const cached = cache.get(key);
    if (cached) return { ...cached, cached: true };

    try {
      const rate = await carrier(shipment, config);
      if (!isRateUsable(rate)) throw new Error('carrier returned an invalid rate');
      const result = cacheResult(cache, key, rate);
      metrics?.increment('carrier.success');
      return result;
    } catch (error) {
      metrics?.increment('carrier.failure');
      logger.warn('carrier quote failed', { message: error.message });
      return unavailableQuote(quoteCurrency(config));
    }
  }

  return {
    quote,
    cache,
    localRate: (shipment) => localRate(shipment.weightKg, shipment.origin, shipment.destination)
  };
}

module.exports = { createQuoteService, cacheKey, quoteResult, unavailableQuote, isRateUsable, quoteCurrency, cacheResult };
