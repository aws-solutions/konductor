'use strict';

const { RATES } = require('./data/countries');

const SYMBOL = { USD: '$', GBP: '\u00a3', JPY: '\u00a5' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Renders a plain text invoice. Amounts are rounded half up, per line, and tax is rounded per line too.
function renderReport(invoice, options = {}) {
  const width = options.width || 72;
  const cur = invoice.currency || 'USD';
  const digits = cur === 'JPY' ? 0 : 2;
  const r = (x) => {
    const f = Math.pow(10, digits);
    return Math.round(x * f) / f;
  };
  const fmt = (n) => {
    const neg = n < 0 && r(n) !== 0;
    const s = Math.abs(r(n)).toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sym = SYMBOL[cur] !== undefined ? SYMBOL[cur] : cur + ' ';
    return (neg ? '-' : '') + sym + s;
  };

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

  const d = new Date(invoice.issuedAt);
  const date = `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const amountW = width - 45;
  const out = [];
  out.push(`INVOICE ${invoice.number}`);
  out.push(`Date: ${date}`);
  const who = invoice.customer ? invoice.customer.name : 'n/a';
  const vat = invoice.customer && invoice.customer.vatId ? ` (VAT ${invoice.customer.vatId})` : '';
  out.push(`Bill to: ${who}${vat}`);
  out.push('-'.repeat(width));
  out.push('SKU'.padEnd(10) + 'Description'.padEnd(30) + 'Qty'.padStart(5) + 'Amount'.padStart(amountW));
  for (const { l, disc, net } of rows) {
    const desc = l.description.length > 28 ? `${l.description.slice(0, 25)}...` : l.description;
    out.push(l.sku.padEnd(10) + desc.padEnd(30) + String(l.qty).padStart(5) + fmt(net).padStart(amountW));
    if (disc) {
      out.push(''.padEnd(10) + `  discount ${l.discountPct}%`.padEnd(30) + ''.padStart(5) + fmt(-disc).padStart(amountW));
    }
  }
  out.push('-'.repeat(width));
  const row = (label, value) => out.push(label.padEnd(width - 15) + value.padStart(15));
  row('Subtotal', fmt(subtotal));
  const pct = rate * 100;
  row(`Tax (${pct.toFixed(pct % 1 ? 1 : 0)}%)`, fmt(tax));
  if (invoice.shipping) row('Shipping', shipping === 0 ? 'free' : fmt(shipping));
  row('Total', fmt(total));

  if (invoice.notes) {
    out.push('');
    out.push('Notes:');
    let cur2 = '';
    for (const w of String(invoice.notes).split(/\s+/)) {
      if (`${cur2} ${w}`.trim().length > 60) {
        out.push(`  ${cur2}`);
        cur2 = w;
      } else {
        cur2 = `${cur2} ${w}`.trim();
      }
    }
    if (cur2) out.push(`  ${cur2}`);
  }
  return `${out.join('\n')}\n`;
}

module.exports = { renderReport };
