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

function roundLineTotal(line) {
  return roundCents(line.unitPrice * line.quantity);
}

function calculateOrder(order, config = loadConfig()) {
  assertOrder(order);
  const shippingMethod = order.shippingMethod || 'standard';
  if (!Object.prototype.hasOwnProperty.call(config.shipping, shippingMethod)) {
    throw new RangeError(`unknown shipping method: ${shippingMethod}`);
  }
  const subtotal = order.lines.reduce((sum, line) => sum + rawLineTotal(line), 0);
  const shipping = config.shipping[shippingMethod];
  return {
    subtotal: roundCents(subtotal),
    discount: 0,
    shipping: roundCents(shipping),
    tax: 0,
    total: roundCents(subtotal + shipping)
  };
}

module.exports = { calculateOrder, loadConfig, roundCents };
