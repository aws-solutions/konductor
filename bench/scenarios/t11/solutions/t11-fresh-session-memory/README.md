# tally

Billing helpers for the Ferry Street co-working space: member invoices, late fees and the front-desk reports.

## Use

```
node bin/tally.js fees --date 2026-11-20                  # late fees owed on that day
node bin/tally.js fees --date 2026-11-20 --file other.json
node bin/tally.js reminders --date 2026-11-20             # payment reminders that go out that day
```

`fees` prints one line per invoice that owes a fee: `<invoice id> <customer> <fee in cents>`, sorted by invoice id.
`reminders` prints one line per reminder: `<invoice id> <customer>`, sorted by invoice id.

## Data

- `data/invoices.json`: `{ "invoices": [{ id, customer, amountCents, issuedOn, dueOn, paidOn }] }`. Dates are
  `YYYY-MM-DD`; `paidOn` is `null` until the invoice is paid.
- `config/holidays.json`: the days the office is closed.

## Code

| File | What |
| --- | --- |
| `src/dates.js` | date strings, weekends and holidays |
| `src/invoices.js` | loads and checks the invoice file |
| `src/latefees.js` | the late fee of one invoice |
| `src/reminders.js` | the payment reminder schedule |
| `src/report.js` | the fees report |
| `bin/tally.js` | the command line |

Billing decisions are written up in `docs/billing-notes.md`.

## Tests

```
npm test
```
