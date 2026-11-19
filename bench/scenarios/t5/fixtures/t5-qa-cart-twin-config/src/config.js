'use strict';

const defaults = require('../config/default.json');

function checkoutConfig(overrides = {}) {
  return {
    ...defaults,
    ...overrides,
    shipping: { ...defaults.shipping, ...(overrides.shipping || {}) }
  };
}

module.exports = { checkoutConfig };
