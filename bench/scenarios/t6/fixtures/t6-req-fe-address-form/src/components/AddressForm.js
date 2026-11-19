'use strict';

const { validateAddress } = require('../validation/address');

function createAddressForm(initial = {}) {
  return {
    fields: {
      addressLine1: initial.addressLine1 || '',
      addressLine2: initial.addressLine2 || '',
      city: initial.city || '',
      region: initial.region || '',
      postalCode: initial.postalCode || '',
      country: initial.country || ''
    },
    submit(fields) {
      return validateAddress(fields);
    }
  };
}

module.exports = { createAddressForm };
