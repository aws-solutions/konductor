# Operations

The service has no external datastore. Restarting it clears the ledger, so the process is intended for local reconciliation and short-lived workers rather than the accounting system of record.

Check `GET /health` before routing traffic. Payment callbacks must include a `payment-signature` value made from the timestamp and exact body. Set `WEBHOOK_SECRET_PRIMARY`, optionally keep `WEBHOOK_SECRET_SECONDARY` during a key rotation, and adjust `WEBHOOK_TOLERANCE_SECONDS` only when the provider's clock policy requires it. Authentication failures return the same generic response.

The default port is 8080. Set `PORT` when running more than one local instance, and set `LEDGER_LABEL` to distinguish their dashboard output.
