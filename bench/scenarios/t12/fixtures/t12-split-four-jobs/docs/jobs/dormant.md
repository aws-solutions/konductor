# DORMFLAG: dormant accounts (port of the legacy batch step DORMFL03)

`src/jobs/dormant.js` exports `run({ asOf, accounts, transactions })`. `asOf` is an ISO date `YYYY-MM-DD`;
`accounts` is an array of `{ id, opened }` (`opened` an ISO date); `transactions` an array of `{ accountId, date }`.

An account is dormant on `asOf` when all of these hold:

- it was opened more than 90 days before `asOf` (opened on `asOf` minus 90 days or later: never dormant);
- it has no transaction dated in the 90 days that end on `asOf`, both ends included (from `asOf` minus 89 days
  through `asOf`);
- transactions dated after `asOf` are ignored, and a transaction for an id that is not in `accounts` is ignored.

Dates are calendar dates: count days in UTC so a clock change does not move a day.

Returns the ids of the dormant accounts, sorted (plain string order), with no repeats.

Example: on `asOf: '2026-06-30'`, an account opened `2026-01-05` whose last transaction is `2026-04-01` is dormant
(April 1 is 90 days before June 30); one whose last transaction is `2026-04-02` is not.
