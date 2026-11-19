# Service dependency notes

`ledger-api` synchronously calls `payment-authorizer` for settlement authorization. It emits an event to `reconciliation` after the ledger write commits. The authorizer has its own pool and the reconciliation consumer can lag without making the API health check fail.

For a release gate, pair API error and latency signals with the authorizer error rate and replica lag. A normal pool-wait warning can be caused by reconciliation bursts, so it is useful context but not proof that a ledger write failed.
