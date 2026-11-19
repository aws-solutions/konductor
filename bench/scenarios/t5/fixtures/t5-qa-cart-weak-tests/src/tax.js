'use strict';

const { ValidationError } = require('./errors');

function calculateTax(taxableCents, rateBps) {
  if (!Number.isInteger(taxableCents) || taxableCents < 0) throw new ValidationError('Taxable amount is invalid');
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) throw new ValidationError('Tax rate is invalid');
  return Math.round(taxableCents * rateBps / 10000);
}

module.exports = { calculateTax };
