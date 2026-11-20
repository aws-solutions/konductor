'use strict';

const { addDays, isBusinessDay } = require('./dates.js');

const RULES = require('../.konductor/memory/billing-rules.json');

/** Business days d with from < d < to. */
function businessDaysBetween(from, to) {
  let n = 0;
  for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) if (isBusinessDay(d)) n += 1;
  return n;
}

// Counting forward: `today` is the 3rd business day before the due date when it is a business day and exactly two
// business days lie between it and the due date.
function goesOutOn(inv, today) {
  if (!isBusinessDay(today) || today >= inv.dueOn) return false;
  return businessDaysBetween(today, inv.dueOn) === RULES.reminderBusinessDaysBefore - 1;
}

function reminderSchedule(invoices, today) {
  const out = [];
  for (const inv of invoices) {
    if (inv.paidOn != null || inv.amountCents < RULES.reminderMinAmountCents) continue;
    if (goesOutOn(inv, today)) out.push({ invoiceId: inv.id, customer: inv.customer, sendOn: today });
  }
  return out.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
}

module.exports = { reminderSchedule };
