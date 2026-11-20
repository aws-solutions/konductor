'use strict';

function assertOrder(order) {
  if (!order || !Array.isArray(order.lines)) {
    throw new TypeError('order.lines must be an array');
  }
  for (const line of order.lines) {
    if (!line || typeof line.sku !== 'string' || !Number.isFinite(line.unitPrice)) {
      throw new TypeError('each line needs a sku and numeric unitPrice');
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new TypeError('each line needs a non-negative integer quantity');
    }
  }
}

module.exports = { assertOrder };
