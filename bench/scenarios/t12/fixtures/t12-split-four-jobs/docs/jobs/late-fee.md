# LATEFEE: late fees (port of the legacy batch step LATEFE04)

`src/jobs/late-fee.js` exports `run({ asOf, bills })`. `asOf` is an ISO date `YYYY-MM-DD`; `bills` is an array of
`{ accountId, due, paid }`: `due` an ISO date, `paid` an ISO date or `null` (not paid yet).

The fee for one bill, in cents:

- paid on or before `due`: 0;
- a bill whose `due` is after `asOf` is not charged yet: 0;
- paid 1 to 30 days after `due`: 2500;
- paid more than 30 days after `due`, or not paid and `asOf` is more than 30 days after `due`: 5000;
- not paid and `asOf` is 1 to 30 days after `due`: 2500.

Days count calendar dates in UTC. An account's fees in one run are capped at 7500 cents in total.

Returns `{ fees: [{ accountId, feeCents }], totalCents }`: one row per account with a fee above 0, sorted by
`accountId`, and the sum of those rows.
