'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertOrder } = require('./validators');

const DEFAULT_CONFIG = path.join(__dirname, 'config', 'default.json');

function loadConfig(filePath = DEFAULT_CONFIG) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function roundCents(value) {
  return Math.floor(value * 100 + 0.5) / 100;
}

function rawLineTotal(line) {
  return line.unitPrice * line.quantity;
}

function discountFor(subtotal, code, promos = {}) {
  const offer = code ? promos[code] : undefined;
  if (!offer || subtotal < offer.minimum) return 0;
  const amount = offer.kind === 'percent'
    ? subtotal * offer.value / 100
    : offer.value;
  return Math.min(amount, subtotal);
}

function calculateOrder(order, config = loadConfig()) {
  assertOrder(order);
  const shippingMethod = order.shippingMethod || 'standard';
  if (!Object.prototype.hasOwnProperty.call(config.shipping, shippingMethod)) {
    throw new RangeError(`unknown shipping method: ${shippingMethod}`);
  }
  const regionName = order.region || 'harbor';
  const region = config.regions && config.regions[regionName];
  if (!region) throw new RangeError(`unknown tax region: ${regionName}`);
  if (order.promoCode && (!config.promos || !config.promos[order.promoCode])) {
    throw new RangeError(`unknown promo code: ${order.promoCode}`);
  }

  const subtotal = order.lines.reduce((sum, line) => sum + rawLineTotal(line), 0);
  const discount = discountFor(subtotal, order.promoCode, config.promos);
  const shipping = config.shipping[shippingMethod];
  const afterDiscount = subtotal - discount;
  const taxableBase = afterDiscount + (region.taxShipping ? shipping : 0);
  const tax = taxableBase * region.rate;

  return {
    subtotal: roundCents(subtotal),
    discount: roundCents(discount),
    shipping: roundCents(shipping),
    tax: roundCents(tax),
    total: roundCents(afterDiscount + shipping + tax)
  };
}

module.exports = { calculateOrder, loadConfig, roundCents };
