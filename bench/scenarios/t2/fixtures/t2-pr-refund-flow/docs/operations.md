# Operations

The worker drains the outbox after a successful ledger append. A process may
be restarted at any point, so jobs must be safe to run more than once.

The memory adapter is intentionally small and is not a substitute for the
production database. Alerts should watch failed captures, stale outbox rows,
and negative projected balances.
