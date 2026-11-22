# Scheduled transfers

A schedule has an id, a client key, two account ids, a decimal amount, an hour, a minute, and a UTC timezone label. The timer calls the worker once for each due schedule.

The worker returns `skipped` for a disabled schedule, `done` for a completed transfer, and records an error result when an account or balance check fails. Scheduled entries use the same two-line journal representation as an ordinary transfer.

Configuration amounts are strings because the ledger stores integer minor units. The configured scale in `config/ledger.json` is used when a schedule is loaded.
