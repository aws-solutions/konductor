# Current order service

## Runtime shape

The order API is a stateless HTTP service in three availability zones. It writes to a PostgreSQL primary and reads from a small pool of read replicas. A transaction creates an order row, its line rows, and an audit row. The API returns the committed order representation after the transaction succeeds.

Fulfillment consumes a database outbox through the relay process. The relay publishes `OrderPlaced`, `OrderCancelled`, and `OrderUpdated` messages to the internal broker. The outbox is retained for 14 days, and fulfillment is allowed to retry a message. The existing relay is owned by the platform team and is already used by two other services.

Support tooling uses the order API for normal changes. A separate support export job reads the audit table for investigations and exports a daily file to the support warehouse. The audit rows include the order identifier, actor identifier, changed fields, and timestamp.

## Persistence baseline

The order tables use UUID order IDs and a server-side `updated_at` timestamp. The API accepts an idempotency key on create and stores it with a unique constraint per customer. Updates use an integer version column. A stale version returns HTTP 409, which the support console displays as a conflict and asks the agent to reload.

PostgreSQL backups run continuously to object storage. The primary database has a 30-day point-in-time recovery window. A restored database is promoted only after the API health check passes and the replica lag is below 30 seconds.

## Dependencies

The API calls the pricing service during checkout and the address service when a shipping address changes. Those calls have a two-second budget inside a five-second request deadline. Fulfillment and the reporting team both depend on the existing order and audit contracts.
