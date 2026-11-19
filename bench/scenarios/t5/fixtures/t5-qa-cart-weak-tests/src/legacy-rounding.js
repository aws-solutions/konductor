'use strict';

// Kept for an old reporting script that still imports this helper.
function dollarsFromCents(cents) {
  return (cents / 100).toFixed(2);
}

module.exports = { dollarsFromCents };
