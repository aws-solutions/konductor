'use strict';

const { addDays, isBusinessDay } = require('./dates.js');

// 0.1% of the invoice amount for each business day late, rounded down to whole cents (billing review 2026-11-19).
const RATE_PER_DAY = 1 / 1000;
// Never more than 10% of the amount.
const CAP = 1 / 10;

/** Business days d with from < d <= to. */
function businessDaysAfter(from, to) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isBusinessDay(d)) n++;
  return n;
}

/**
 * The late fee of one invoice on `asOf` (YYYY-MM-DD), in cents. Only business days count, starting the day after the
 * due date. A paid invoice stops accruing on the day it was paid.
 */
function lateFeeCents(invoice, asOf) {
  const end = invoice.paidOn && invoice.paidOn < asOf ? invoice.paidOn : asOf;
  if (end <= invoice.dueOn) return 0;
  const cap = Math.floor(invoice.amountCents * CAP);
  const late = businessDaysAfter(invoice.dueOn, end);
  return Math.min(Math.floor(invoice.amountCents * late * RATE_PER_DAY), cap);
}

module.exports = { lateFeeCents, businessDaysAfter, RATE_PER_DAY, CAP };
