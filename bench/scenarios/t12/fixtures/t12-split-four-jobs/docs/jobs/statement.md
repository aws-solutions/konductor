# STMTLINE: statement lines (port of the legacy batch step STMTLN02)

`src/jobs/statement.js` exports `run(transactions)`. `transactions` is an array of
`{ date, description, amountCents }`: `date` an ISO date `YYYY-MM-DD`, `description` a string, `amountCents` an
integer (negative for a payment or a refund).

Returns an array of strings, one per transaction in date order (the input order for equal dates), then one total line.

Each transaction line is exactly 42 characters:

| columns | content |
| --- | --- |
| 1-10 | the date as given |
| 11 | a space |
| 12-31 | the description in upper case, cut to 20 characters or padded with spaces on the right |
| 32 | a space |
| 33-42 | the amount: digits with a comma every three digits, a `.` and two decimals, and a trailing `-` for a negative amount or a trailing space otherwise, right-aligned in 10 columns |

The total line is `TOTAL` padded with spaces to 31 characters, a space, and the sum of all amounts in the same
10-column format. An amount that does not fit in 10 columns throws a `RangeError`.

Example: `{ date: '2026-03-02', description: 'Coffee beans', amountCents: -1250 }` gives
`2026-03-02 COFFEE BEANS             12.50-`.
