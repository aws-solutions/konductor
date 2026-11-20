'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for an ISO timestamp, as the billing team reads it (the invoice's UTC date). */
function invoiceDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { invoiceDate };
