'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertOrder } = require('./validators');

const CONFIG_PATH = path.resolve(__dirname, 'config', 'default.json');

function loadConfig(file = CONFIG_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cents(value) {
  return Math.round(value * 100 + 1e-8) / 100;
}

function lineValue(line) {
  return line.unitPrice * line.quantity;
}

function offerValue(base, code, offers) {
  const offer = offers && code ? offers[code] : null;
  if (!offer || base < offer.minimum) return 0;
  const value = offer.kind === 'percent' ? base * offer.value / 100 : offer.value;
  return Math.min(base, value);
}

function calculateOrder(order, config = loadConfig()) {
  assertOrder(order);
  const method = order.shippingMethod || 'standard';
  const delivery = config.shipping[method];
  if (delivery === undefined) throw new RangeError(`unknown shipping method: ${method}`);

  const place = order.region || 'harbor';
  const taxRule = config.regions && config.regions[place];
  if (!taxRule) throw new RangeError(`unknown tax region: ${place}`);
  if (order.promoCode && (!config.promos || !config.promos[order.promoCode])) {
    throw new RangeError(`unknown promo code: ${order.promoCode}`);
  }

  const basket = order.lines.reduce((sum, line) => sum + lineValue(line), 0);
  const discount = offerValue(basket, order.promoCode, config.promos);
  const net = basket - discount;
  const taxBase = taxRule.taxShipping ? net + delivery : net;
  const tax = taxBase * taxRule.rate;

  return {
    subtotal: cents(basket),
    discount: cents(discount),
    shipping: cents(delivery),
    tax: cents(tax),
    total: cents(net + delivery + tax)
  };
}

module.exports = { calculateOrder, loadConfig, roundCents: cents };
