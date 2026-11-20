'use strict';

const { addDays, isBusinessDay } = require('./dates.js');

// Billing review 2026-11-19: a reminder goes out 3 business days before the due date; none for a paid invoice or an
// amount under 500 cents.
const BUSINESS_DAYS_BEFORE = 3;
const MIN_AMOUNT_CENTS = 500;

/** The day the reminder of an invoice due on `dueOn` goes out. */
function sendOnFor(dueOn) {
  let d = dueOn;
  for (let n = 0; n < BUSINESS_DAYS_BEFORE;) {
    d = addDays(d, -1);
    if (isBusinessDay(d)) n++;
  }
  return d;
}

/** Reminders that go out on `today`: [{ invoiceId, customer, sendOn }], sorted by invoiceId. */
function reminderSchedule(invoices, today) {
  return invoices
    .filter((inv) => inv.paidOn == null && inv.amountCents >= MIN_AMOUNT_CENTS)
    .map((inv) => ({ invoiceId: inv.id, customer: inv.customer, sendOn: sendOnFor(inv.dueOn) }))
    .filter((r) => r.sendOn === today)
    .sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0));
}

module.exports = { reminderSchedule, sendOnFor, BUSINESS_DAYS_BEFORE, MIN_AMOUNT_CENTS };
