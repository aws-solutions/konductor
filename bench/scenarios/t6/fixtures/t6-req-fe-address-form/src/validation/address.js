'use strict';

const { postcodeLooksValid } = require('./postcode');

function validateAddress(fields = {}) {
  const errors = {};
  for (const name of ['addressLine1', 'city', 'postalCode', 'country']) {
    if (!String(fields[name] || '').trim()) errors[name] = 'Enter a value';
  }
  if (fields.region === undefined) errors.region = 'Enter a value';
  if (!errors.postalCode && !postcodeLooksValid(fields.country, fields.postalCode)) {
    errors.postalCode = 'Enter a valid postal code';
  }
  return errors;
}

module.exports = { validateAddress };
