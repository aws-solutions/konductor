'use strict';

const keys = require('../data/keys.json');

/** The caller for an API key ({ key, owner, plan, admin }), or null. */
function authenticate(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey) return null;
  return keys.find((k) => k.key === apiKey) || null;
}

module.exports = { authenticate };
