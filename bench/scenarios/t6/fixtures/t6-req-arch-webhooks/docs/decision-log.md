# Decision log excerpts

- The outbox remains the source of truth for committed ledger changes.
- External calls must be asynchronous with respect to payment writes.
- Account identifiers are the current broker partition key.
- A public integration may be disabled without deleting its historical delivery records.

The log has no entry for webhook payload versioning, receiver verification, or delivery retention.
