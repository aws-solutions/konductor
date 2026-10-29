'use strict';

const { formatMoney } = require('./money');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateLabel(issuedAt) {
  const d = new Date(issuedAt);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function wrapNotes(notes) {
  const out = ['', 'Notes:'];
  let cur = '';
  for (const w of String(notes).split(/\s+/)) {
    if (`${cur} ${w}`.trim().length > 60) {
      out.push(`  ${cur}`);
      cur = w;
    } else {
      cur = `${cur} ${w}`.trim();
    }
  }
  if (cur) out.push(`  ${cur}`);
  return out;
}

function renderText(invoice, calc, width) {
  const fmt = (n) => formatMoney(n, calc.cur);
  const amountW = width - 45;
  const out = [];
  const who = invoice.customer ? invoice.customer.name : 'n/a';
  const vat = invoice.customer && invoice.customer.vatId ? ` (VAT ${invoice.customer.vatId})` : '';
  out.push(`INVOICE ${invoice.number}`, `Date: ${dateLabel(invoice.issuedAt)}`, `Bill to: ${who}${vat}`, '-'.repeat(width));
  out.push('SKU'.padEnd(10) + 'Description'.padEnd(30) + 'Qty'.padStart(5) + 'Amount'.padStart(amountW));
  for (const { l, disc, net } of calc.rows) {
    const desc = l.description.length > 28 ? `${l.description.slice(0, 25)}...` : l.description;
    out.push(l.sku.padEnd(10) + desc.padEnd(30) + String(l.qty).padStart(5) + fmt(net).padStart(amountW));
    if (disc) {
      out.push(''.padEnd(10) + `  discount ${l.discountPct}%`.padEnd(30) + ''.padStart(5) + fmt(-disc).padStart(amountW));
    }
  }
  out.push('-'.repeat(width));
  const row = (label, value) => out.push(label.padEnd(width - 15) + value.padStart(15));
  row('Subtotal', fmt(calc.subtotal));
  const pct = calc.rate * 100;
  row(`Tax (${pct.toFixed(pct % 1 ? 1 : 0)}%)`, fmt(calc.tax));
  if (invoice.shipping) row('Shipping', calc.shipping === 0 ? 'free' : fmt(calc.shipping));
  row('Total', fmt(calc.total));
  if (invoice.notes) out.push(...wrapNotes(invoice.notes));
  return `${out.join('\n')}\n`;
}

module.exports = { renderText };
