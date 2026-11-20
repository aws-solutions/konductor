'use strict';

const { daysBetween } = require('./dates.js');

// 0.1% of the invoice amount for each day late, rounded down to whole cents.
const RATE_PER_DAY = 1 / 1000;
// Never more than 10% of the amount.
const CAP = 1 / 10;

/**
 * The late fee of one invoice on `asOf` (YYYY-MM-DD), in cents. A paid invoice stops accruing on the day it was paid.
 */
function lateFeeCents(invoice, asOf) {
  const end = invoice.paidOn && invoice.paidOn < asOf ? invoice.paidOn : asOf;
  const late = daysBetween(invoice.dueOn, end);
  if (late <= 0) return 0;
  const fee = Math.floor(invoice.amountCents * late * RATE_PER_DAY);
  return Math.min(fee, Math.floor(invoice.amountCents * CAP));
}

module.exports = { lateFeeCents, RATE_PER_DAY, CAP };
