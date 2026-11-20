'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertOrder } = require('./validators');

const CONFIG = path.join(__dirname, 'config', 'default.json');
function loadConfig(file = CONFIG) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function roundCents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function roundLineTotal(line) {
  return roundCents(line.unitPrice * line.quantity);
}
function calculateOrder(order, config = loadConfig()) {
  assertOrder(order);
  const method = order.shippingMethod || 'standard';
  if (!Object.prototype.hasOwnProperty.call(config.shipping, method)) {
    throw new RangeError(`unknown shipping method: ${method}`);
  }
  if (order.region) {
    throw new RangeError('regional estimates are not available');
  }
  const offer = order.promoCode && config.promos && config.promos[order.promoCode];
  const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);
  const discount = offer && subtotal >= offer.minimum
    ? (offer.kind === 'percent' ? subtotal * offer.value / 100 : offer.value)
    : 0;
  const shipping = config.shipping[method];
  return {
    subtotal: roundCents(subtotal),
    discount: roundCents(Math.min(discount, subtotal)),
    shipping: roundCents(shipping),
    tax: 0,
    total: roundCents(subtotal - discount + shipping)
  };
}
module.exports = { calculateOrder, loadConfig, roundCents };
