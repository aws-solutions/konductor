'use strict';

// Integer cents to a decimal string with two places, e.g. 12050 -> "120.50".
function formatMoney(cents) {
  return (cents / 100).toFixed(2);
}

module.exports = { formatMoney };
