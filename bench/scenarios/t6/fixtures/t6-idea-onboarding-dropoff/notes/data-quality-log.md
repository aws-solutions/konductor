# Data quality log

- 22 Jan: weekly export had duplicate profile rows; rerun included in current CSV.
- 5 Feb: `email_verified` app mirror was lower than identity ledger for the week beginning 3 Feb.
- 7 Feb: support tags deduplicated by ticket, not user.
- 11 Feb: provider summary checked against the messaging ledger. Cloudmail delivery-rate calculation uses sent as the denominator.

The current exports use UTC week starts. Release dates are local time, so the 20 January row is a mixed week around the cutover.
