'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for an ISO timestamp, as the billing team reads it (the invoice's UTC date, whatever the server zone). */
function invoiceDate(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

module.exports = { invoiceDate };
