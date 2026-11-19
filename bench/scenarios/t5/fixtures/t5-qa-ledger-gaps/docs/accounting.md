# Accounting notes

Pocket Ledger uses a transfer model: the amount leaves the debit account and enters the credit account. A transfer is stored once, which keeps the two sides together for exports.

Rates are annual decimal rates. Interest uses the actual number of requested days over a 365-day year and is rounded to cents with decimal half-up rounding. A positive balance receives interest; a negative balance records an account charge.

A monthly fee is a positive input amount. It reduces the named account and credits the fee income account. Invalid non-positive fee inputs are rejected before they can create a posting.
