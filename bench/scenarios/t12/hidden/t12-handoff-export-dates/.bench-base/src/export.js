'use strict';

const fs = require('node:fs');
const { invoiceDate } = require('./format-date');

const COLUMNS = ['invoice_id', 'customer', 'issued_on', 'due_on', 'amount_cents', 'currency'];

const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function toCsv(invoices) {
  const rows = invoices.map((inv) => [inv.id, inv.customer, invoiceDate(inv.issuedAt), invoiceDate(inv.dueAt), inv.amountCents, inv.currency]);
  return [COLUMNS, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

if (require.main === module) process.stdout.write(toCsv(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))));

module.exports = { toCsv, COLUMNS };
