'use strict';

function lookupLabel(country) {
  return country === 'GB' ? 'Find an address' : 'Search for your address';
}

function lookupResultToFields(result = {}) {
  return {
    addressLine1: result.line1 || '',
    city: result.city || '',
    region: result.region || '',
    postalCode: result.postalCode || '',
    country: result.country || ''
  };
}

module.exports = { lookupLabel, lookupResultToFields };
