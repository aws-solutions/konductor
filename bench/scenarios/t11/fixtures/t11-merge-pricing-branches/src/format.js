'use strict';

function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

function formatQuote(quote) {
  return `Total ${formatAmount(quote.total)}`;
}

module.exports = { formatAmount, formatQuote };
