# Billing notes

Working notes from the billing syncs. Newest first.

## 2026-11-19 billing review (Priya, Tomasz)

Settled; replaces the September notes on late fees and reminders.

- Late fees count business days only: weekdays not in `config/holidays.json`, starting the day after the due date.
  The rate stays 0.1% of the amount per business day, rounded down to whole cents, capped at 10%. Done in `src/latefees.js`.
- Payment reminders go out 3 business days before the due date, counted the same way. Done in `src/reminders.js`.
- No reminder for an invoice that is already paid, or whose amount is under 500 cents.

## 2026-09-14 sync (Priya, Tomasz, Jun)

Superseded by the 2026-11-19 review for late fees and reminders.

- Late fees: 0.1% of the amount for every calendar day past the due date, rounded down to whole cents, capped at 10%.
  A paid invoice stops accruing on the day it was paid.
- Payment reminders (not built yet): send a reminder 5 calendar days before the due date, to every unpaid invoice.
  Output for the front desk: one line per reminder, invoice id and customer.
- Jun asked whether weekends should count. Parked for now.

## 2026-07-02 sync (Priya, Tomasz)

- Invoices move from the spreadsheet to `data/invoices.json`. Amounts are whole cents.
- Customer names have no spaces in the file (the front desk's label printer splits on spaces).
- Holidays are the office closing days in `config/holidays.json`.
