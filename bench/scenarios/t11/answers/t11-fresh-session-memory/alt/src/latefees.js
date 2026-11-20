'use strict';

const { addDays, daysBetween, isBusinessDay } = require('./dates.js');

const RATE_PER_DAY = 1 / 1000;
const CAP = 1 / 10;

/** Late fee in cents on `asOf`: business days after the due date (paid invoices stop on their payment day), capped. */
function lateFeeCents(invoice, asOf) {
  const end = invoice.paidOn && invoice.paidOn < asOf ? invoice.paidOn : asOf;
  const span = daysBetween(invoice.dueOn, end);
  const days = Array.from({ length: Math.max(0, span) }, (_, i) => addDays(invoice.dueOn, i + 1)).filter(isBusinessDay);
  const fee = Math.floor((invoice.amountCents * days.length) / 1000);
  return Math.min(fee, Math.floor(invoice.amountCents / 10));
}

module.exports = { lateFeeCents, RATE_PER_DAY, CAP };
