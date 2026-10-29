'use strict';

const { RATES } = require('./data/countries');
const { roundFor } = require('./money');

// Sorted rows with gross, discount and net, plus subtotal, tax, shipping and total.
function computeInvoice(invoice) {
  const cur = invoice.currency || 'USD';
  const r = roundFor(cur);
  const lines = invoice.lines.slice().sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  const rows = [];
  let subtotal = 0;
  let taxable = 0;
  for (const l of lines) {
    const gross = r(l.qty * l.unitPrice);
    const disc = l.discountPct ? r((gross * l.discountPct) / 100) : 0;
    const net = r(gross - disc);
    subtotal += net;
    if (l.taxable !== false) taxable += net;
    rows.push({ l, gross, disc, net });
  }
  subtotal = r(subtotal);
  const country = invoice.customer && invoice.customer.country;
  const rate = RATES[country] || 0;
  const tax = r(taxable * rate);
  let shipping = invoice.shipping || 0;
  if (subtotal > 100) shipping = 0;
  const total = r(subtotal + tax + shipping);
  return { cur, rows, subtotal, rate, tax, shipping, total };
}

module.exports = { computeInvoice };
