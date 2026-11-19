'use strict';

const { ValidationError } = require('./errors');

function calculateShipping(subtotalCents, options = {}) {
  const threshold = options.freeShippingThresholdCents ?? 5000;
  const standard = options.standardShippingCents ?? 799;
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) throw new ValidationError('Subtotal is invalid');
  if (!Number.isInteger(threshold) || threshold < 0 || !Number.isInteger(standard) || standard < 0) {
    throw new ValidationError('Shipping settings are invalid');
  }
  return subtotalCents > threshold ? 0 : standard;
}

module.exports = { calculateShipping };
