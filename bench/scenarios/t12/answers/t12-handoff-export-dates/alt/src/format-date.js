'use strict';

/** YYYY-MM-DD for an ISO timestamp: the invoice's UTC date, which the ISO form of the instant starts with. */
function invoiceDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

module.exports = { invoiceDate };
