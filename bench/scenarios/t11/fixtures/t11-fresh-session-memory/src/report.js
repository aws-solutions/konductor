'use strict';

const { lateFeeCents } = require('./latefees.js');

/** Invoices with a fee on `asOf`, sorted by id: [{ id, customer, feeCents }]. */
function feesReport(invoices, asOf) {
  return invoices
    .map((inv) => ({ id: inv.id, customer: inv.customer, feeCents: lateFeeCents(inv, asOf) }))
    .filter((r) => r.feeCents > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function formatCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

module.exports = { feesReport, formatCents };
