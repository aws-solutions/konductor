'use strict';

function assertOrder(order) {
  if (!order || !Array.isArray(order.lines)) {
    throw new TypeError('order.lines must be an array');
  }
  if (order.lines.length > 1) {
    throw new TypeError('only one cart line is supported');
  }
  for (const line of order.lines) {
    if (!line || typeof line.sku !== 'string' || !Number.isFinite(line.unitPrice)) {
      throw new TypeError('each line needs a sku and numeric unitPrice');
    }
    if (line.quantity === 0) {
      throw new TypeError('Invalid cart line 0: quantity must be positive');
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new TypeError('each line needs a non-negative integer quantity');
    }
  }
}

module.exports = { assertOrder };
