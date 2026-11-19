'use strict';

const { ValidationError } = require('./errors');

function lineTotal(unitPriceCents, quantity) {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new ValidationError('Unit price must be a non-negative integer');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ValidationError('Quantity must be a positive integer');
  }
  return unitPriceCents * quantity;
}

function subtotal(lines) {
  if (!Array.isArray(lines)) throw new ValidationError('Lines are required');
  return lines.reduce((sum, line) => sum + lineTotal(line.unitPriceCents, line.quantity), 0);
}

module.exports = { lineTotal, subtotal };
