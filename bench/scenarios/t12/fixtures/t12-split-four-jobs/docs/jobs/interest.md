# INTCALC: monthly interest (port of the legacy batch step INTCALC01)

`src/jobs/interest.js` exports `run(accounts)`. `accounts` is an array of
`{ id, status, balanceCents, apr }`: `id` a string, `status` `"active"`, `"frozen"` or `"closed"`, `balanceCents` an
integer (negative is a credit balance), `apr` a decimal string such as `"19.99"` (percent a year).

For each account:

- `closed` accounts are skipped (no output row). `frozen` accounts get interest like active ones.
- An account with a balance of 0 or less gets no row.
- Interest in cents is `balanceCents * apr / 100 / 12`, rounded half up to a whole cent
  (`12.5` becomes `13`). Compute with integers where you can: the legacy job used fixed-point, and `apr` has at most
  two decimals. A floating-point result that is off by one cent is a defect.
- An `apr` that is not a decimal string with at most two decimals (`"abc"`, `"1.234"`, `""`) throws an `Error` whose
  message names the account id.

Returns `[{ id, interestCents }]` sorted by `id` (plain string order).

Example: `run([{ id: 'A2', status: 'active', balanceCents: 120000, apr: '19.99' }])` is
`[{ id: 'A2', interestCents: 1999 }]`.
