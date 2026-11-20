'use strict';

const { addDays } = require('./dates.js');

// docs/billing-notes.md (September sync): a reminder 5 calendar days before the due date, to every unpaid invoice.
const DAYS_BEFORE = 5;

function reminderSchedule(invoices, today) {
  return invoices
    .filter((inv) => inv.paidOn == null)
    .map((inv) => ({ invoiceId: inv.id, customer: inv.customer, sendOn: addDays(inv.dueOn, -DAYS_BEFORE) }))
    .filter((r) => r.sendOn === today)
    .sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0));
}

module.exports = { reminderSchedule };
