'use strict';

const { SUPPORTED_COUNTRIES, MAX_WEIGHT_KG } = require('./constants');

function validateAddress(address, name) {
  if (!address || typeof address !== 'object') throw new TypeError(`${name} is required`);
  if (!SUPPORTED_COUNTRIES.has(address.country)) throw new RangeError(`${name}.country is not supported`);
  if (typeof address.postalCode !== 'string' || address.postalCode.length < 3) {
    throw new TypeError(`${name}.postalCode is invalid`);
  }
}

function validateShipment(input) {
  validateAddress(input.origin, 'origin');
  validateAddress(input.destination, 'destination');
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0 || input.weightKg > MAX_WEIGHT_KG) {
    throw new RangeError('weightKg is outside the supported range');
  }
}

module.exports = { validateShipment };
