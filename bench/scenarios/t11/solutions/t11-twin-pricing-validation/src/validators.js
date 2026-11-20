'use strict';

function invalidLine(index, field, detail) {
  throw new TypeError(`Invalid cart line ${index}: ${field} ${detail}`);
}

function assertOrder(order) {
  if (!order || !Array.isArray(order.lines)) {
    throw new TypeError('order.lines must be an array');
  }

  for (let index = 0; index < order.lines.length; index += 1) {
    const line = order.lines[index];
    if (!line || typeof line.sku !== 'string') {
      invalidLine(index, 'sku', 'must be a string');
    }
    if (!Number.isFinite(line.unitPrice)) {
      invalidLine(index, 'unitPrice', 'must be a finite number');
    }
    if (line.unitPrice < 0) {
      invalidLine(index, 'unitPrice', 'must not be negative');
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      invalidLine(index, 'quantity', 'must be a positive integer');
    }
  }
}

module.exports = { assertOrder };
