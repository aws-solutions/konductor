'use strict';

const { ValidationError } = require('./errors');

function cents(value) {
  if (!Number.isInteger(value) || value < 0) throw new ValidationError('money must be a non-negative integer', { value });
  return value;
}

function multiplyCents(amount, numerator, denominator) {
  cents(amount);
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new ValidationError('invalid money ratio');
  }
  return Math.round((amount * numerator) / denominator);
}

function formatCents(value, currency = 'USD') {
  if (!Number.isInteger(value)) throw new ValidationError('money must be an integer');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value / 100);
}

module.exports = { cents, multiplyCents, formatCents };
