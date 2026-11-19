# ADR-0007: Event-sourced order aggregates

- **Status:** Proposed
- **Date:** 2025-02-12
- **Owners:** Order Platform
- **Decision type:** Persistence and integration architecture

## 1. Decision summary

We will move the order service from mutable order tables to an event-sourced aggregate. Each accepted command will append an immutable event to the order stream. Read models will be built from those events for the customer API, support console, fulfillment integration, and reporting feeds.

The change gives the order team a durable history of state transitions, makes support actions explainable, and lets us rebuild a read model when a query changes. PostgreSQL will remain the first persistence technology, so the team keeps its existing operational tools and backup path. The broker will continue to distribute integration messages.

This ADR is complete enough to begin a schema spike and a staged migration. The design below fixes the ambiguity in the current audit trail without changing the public order endpoints. We believe it is the smallest change that gives the product a reliable history and leaves room for future order workflows.

## 2. Context and goals

### 2.1 Current pain

The current service stores the latest order row and a separate audit row. The audit row is useful for support, but it is not a complete representation of every state transition. Several code paths update an order and then add an audit description, which makes it hard to reconstruct exact old values. A new fulfillment rule also requires a historical status transition rather than only the current status.

The service handles a large and growing order population. Checkout, support corrections, cancellation, and fulfillment updates all mutate the same aggregate. We want one authoritative sequence for those changes and a way to make new read shapes without adding more transactionally coupled tables.

### 2.2 Goals and non-goals

The goals are to preserve the existing HTTP contract, record a complete order history, support deterministic aggregate reconstruction, and publish stable facts to downstream consumers. The design must support idempotent client retries and optimistic conflict detection. It should also keep the order API within its existing latency and availability objectives.

We will not replace the broker, rewrite fulfillment, or introduce a new database vendor in this project. We will not change pricing calculation or address validation. The first release covers placement, address correction, line changes, and cancellation. Returns and exchanges remain future commands.

### 2.3 Constraints and assumptions

PostgreSQL remains a managed service with point-in-time backups. The existing broker is available to the order team, and its delivery model is at-least-once. The order API remains stateless and can be deployed in three zones. Commands are expected to be small, and an order normally has fewer than eight transitions during checkout and fulfillment.

A customer and a support agent both need a current representation after a successful command. Read models can be rebuilt from the event store, and a projection can be deployed independently of the command path. We assume that an order's event stream is naturally ordered by its aggregate identifier.

## 3. Proposed design

### 3.1 Command and event flow

The API validates a command, loads the order aggregate, and checks the expected version supplied by the caller. Domain rules produce one or more events. In one PostgreSQL transaction, the service appends those events, advances the stream version, records the idempotency key, and updates a small command receipt table. A unique constraint on the aggregate and version prevents two writers from committing the same sequence.

A relay reads committed event rows and publishes integration messages to the broker. The relay records its publication cursor and can publish a message again after a crash. Consumers use the event ID as their idempotency key. The customer and support projections consume the internal stream, while fulfillment receives an `OrderPlaced` message with the existing external shape.

The event table will have `order_id`, `sequence`, `event_id`, `event_type`, `occurred_at`, `actor_id`, `correlation_id`, and a JSON payload. The primary key is `(order_id, sequence)`, with a unique index on `event_id`. Commands return the order ID, stream version, and a receipt identifier. The API will keep returning the existing status codes for validation, conflict, and not-found results.

### 3.2 Event contract and long-lived data

Events are facts and are never updated in place. Initial event types are `OrderPlaced`, `AddressChanged`, `LineQuantityChanged`, and `OrderCancelled`. The payload contains the complete values needed by the aggregate, including customer ID, delivery address, line identifiers, quantity, and price. This makes replay independent of the current order tables.

The first event contract will be documented in the repository and reviewed by the order team. New optional fields can be added with defaults, and event consumers will ignore fields they do not recognize. A serializer test will protect the field names and JSON types. Events will be retained for the life of the service so any projection can be rebuilt from the source history.

### 3.3 Customer and support reads

Projection workers consume events asynchronously and write `order_summary` and `support_order` rows. They checkpoint their event position and retry failed records with exponential backoff. A freshness gauge will show the age of the newest event not yet applied. A projection can be rebuilt in a separate table and swapped after it catches up.

After a command commits, the API returns the receipt and order identifier. The customer detail and list endpoints read the customer projection, which normally catches up within two seconds. If a projection is behind, the API returns the last available row with its version and the client can request the detail again. This keeps command latency independent of projection work and avoids making every read a transaction against the event table.

Support changes use the version from the support projection. The command handler rejects an old version with a conflict and the console reloads the row. For a new order, the customer projection is populated by the same worker path as any other order, and the existing mobile and web clients need no changes.

### 3.4 Recovery and replay

The event store is backed up with the same continuous backup policy as the current database. A regional recovery starts a PostgreSQL restore, promotes the instance, starts the relay, and starts the customer and support workers. We will rebuild a missing projection from the event table before directing all reads to it.

A staging benchmark replayed a representative stream at 2.5 million events per minute. The current event count is approximately 174.7 million, so the design estimates a full replay at about ten minutes, followed by five minutes for restore and startup. The total fits the 15-minute recovery objective. A future year's projected event count is expected to remain within the same operating envelope because the workers can be scaled horizontally.

The recovery runbook will include restore, event-store verification, projection startup, and traffic cutover. The event store is the source of truth, so a projection may be discarded and regenerated without data loss. During a rebuild, the API can continue accepting commands against the event store and the workers will process the new events after the historical backlog.

### 3.5 Customer data and retention

The event payload includes the customer identifier and the delivery address because those values are required to reconstruct an order and to explain a support action. It may also include the recipient name and contact details when the shipping destination differs from the account. The event log is append-only and is retained indefinitely as the source of truth.

The deletion worker will delete customer rows from the customer projection and remove the customer from search indexes. Support and reporting projections will receive the same deletion notification. The immutable event stream remains available for reconstruction and audit, while normal API responses will no longer find the deleted customer record.

Access to the event table is limited to the order service role and the recovery role. Payloads are encrypted at rest, and application logs will use order IDs rather than full event bodies. The event history gives support a reliable account of who changed an order and when.

### 3.6 Options considered

We considered keeping the current CRUD model, adopting event sourcing as described here, or moving to a hosted event database. The current CRUD model has a simple read path but does not provide a complete history or a clean way to rebuild new views. A hosted event database provides stream operations but adds a second operational platform and a new backup contract. Event sourcing in PostgreSQL gives us history while keeping the existing team and recovery tools.

The comparison is:

| Option | History | Read path | Operations | Migration |
| --- | --- | --- | --- | --- |
| Current CRUD tables | Current state only | Simple SQL | Familiar | Lowest |
| Event-sourced PostgreSQL | Complete event stream | Projections | Existing database plus workers | Moderate |
| Hosted event database | Complete event stream | Projections | New vendor | Highest |

The event-sourced design wins because history and projection rebuilds matter more than the extra worker. We will not retain two authoritative write models after migration.

### 3.7 Snapshots and stream size

An aggregate is reconstructed by reading its events in sequence. Long-lived orders may eventually contain more events than a normal checkout, particularly when support corrects an address repeatedly. Snapshots will be used to avoid applying the entire stream for every command and to keep command latency stable.

A snapshot contains the aggregate state, the last applied sequence, and a format marker. Snapshot records will be associated with the order and treated as derived data. The command handler will use the newest usable snapshot and then apply later events. If a snapshot is corrupt or from an older format, the handler will rebuild from the event stream.

The implementation will choose an interval during the schema spike based on observed stream lengths. Snapshots are expected to live in PostgreSQL beside the event table and will be covered by the existing database backup. Rebuilding snapshots is safe because the event stream remains authoritative.

### 3.8 Reporting and downstream consumers

The reporting team will no longer read mutable order tables after the migration. The reporting projection will expose current order state, line items, status transitions, actor identifiers, and event timestamps. A reporting API can serve ad hoc questions, while scheduled reports can consume a daily export of the projection.

This removes direct database access from reporting and prevents analytical queries from competing with command traffic. The projection can be indexed for the report shapes, and a separate worker can publish a compact report feed to the warehouse. Existing fulfillment messages continue to use their current contract.

## 4. Data model and consistency

### 4.1 Event store tables

The `order_events` table stores one row per event and is partitioned by event month. The aggregate key remains the order UUID. `order_streams` stores the current version and a pointer to the latest snapshot. `command_receipts` stores the idempotency key, command result, and expiration timestamp. A receipt is returned for a retry even when the original response was lost.

The customer projection includes the customer ID, order number, status, totals, and a projection version. The support projection includes the same order state plus the last actor and reason. Projection writes use an event ID uniqueness constraint so a worker restart does not apply a record twice.

### 4.2 Ordering and conflicts

Commands for one order are serialized by the stream version. A command with an expected version that is not current fails without appending an event. Events for different orders can be appended concurrently. The relay preserves the order of events within an order when it publishes integration messages.

The API rejects a duplicate idempotency key if it is associated with a different command body. A client may safely retry the same body after a timeout. Fulfillment receives the placement message once logically, even if the broker sees a duplicate delivery.

## 5. Migration plan

### 5.1 Backfill and dual operation

We will first create the event table and projection schemas. A one-time converter will read each current order and its audit rows, create an `OrderPlaced` event plus subsequent events where the old audit row contains enough information, and record the source row identifier. Orders without a detailed old value will receive a state capture event so their current behavior remains available.

For new writes, a feature flag will route a small customer cohort to the event command handler. During the first stage, the handler will write the legacy tables from the customer projection for compatibility. The relay will continue to publish existing fulfillment messages. We will compare status, totals, and version values between the two representations before expanding the cohort.

### 5.2 Cutover and rollback

The migration has four gates: backfill completeness, projection parity, latency at the target percentile, and successful recovery exercise. The migration dashboard will show command errors, version conflicts, relay lag, projection freshness, and event-to-table differences. The order team will expand from internal accounts to five percent, then 25 percent, then all customers.

A flag can route commands back to the legacy handler before the event path becomes authoritative. Once the event store is authoritative, rollback means keeping the event path and rebuilding the legacy compatibility tables from the projection; no writes will be sent to two independent authorities. The team will retain the legacy tables for one release after full cutover.

## 6. Operations

### 6.1 Monitoring and alerts

Dashboards will cover append latency, command failures, version conflicts, event-store growth, relay lag, projection freshness, projection error rate, and snapshot use. Alerts will fire when the customer projection is more than 30 seconds behind, when a consumer stops advancing, or when the event append p95 exceeds the API target.

Workers will expose a dead-letter count and a retry age. An operator can pause a projection, inspect a failed event, and resume from its checkpoint. Rebuilds will use a separate table and a named cutover operation so an incomplete rebuild does not replace a healthy projection.

### 6.2 Capacity and cost

The event table will grow with order activity and event history. Partitioning and indexes will be reviewed monthly. PostgreSQL storage, backup storage, broker traffic, and worker compute will be included in the service budget. The first capacity test will use the projected next-year event count and a two-times burst for checkout.

The order team will own the application dashboards and replay commands. Platform will own the managed database and broker. The on-call runbook will document how to fence commands, restore the database, start consumers, and verify projection positions before traffic is opened.

## 7. Security and compliance

### 7.1 Access controls

Only the order service can append events. Projection workers have read access to the event stream and write access to their own schemas. The recovery role is separate and requires an approved emergency access grant. Reporting receives only the fields in its projection, not the raw event table.

All service-to-service calls use the existing workload identity. Database connections use TLS, and secrets remain in the managed secret store. Audit records include actor, command, correlation ID, and result. Operators will not place event payloads in request logs.

### 7.2 Audit interpretation

An event is an accepted domain fact, not a statement that every downstream view has caught up. The support console will show the event version and actor for a completed command. Corrections are represented as new facts rather than edits to old facts, which lets investigators explain the order's history.

## 8. Rollout decision

The team recommends approval for a two-week schema and throughput spike followed by the staged migration. The spike will validate aggregate commands, the relay, projection rebuild, and the recovery runbook using production-shaped data. It will also produce the first capacity estimate for storage and workers.

The architecture is preferable to adding more mutable tables because it gives the order service one history and independent read models while retaining PostgreSQL and the current broker. The public API stays stable, the migration can be gated, and a projection can be recreated when reporting or customer views change. With the rollout gates and operational dashboards above, the team considers this proposal ready to implement.

## 9. Appendix: implementation sketch

### 9.1 Placement request

The placement handler first authenticates the customer and validates the cart, then creates a command with a correlation ID and the caller's idempotency key. The command gateway looks for an existing receipt before loading the aggregate. For a new key, the aggregate loader reads the stream, applies domain rules, and returns the next version. The transaction appends the resulting facts, inserts the receipt, and commits both records together.

The response mapper keeps the current API shape. It translates the accepted command result into the existing order number, status, totals, and links. A command that fails validation writes no event. A conflict includes the current version so the caller can choose to refresh. The handler records timing for load, domain evaluation, append, and commit as separate metrics.

### 9.2 Projection deployment

A new projection is created with a schema version, an empty checkpoint, and a table name that includes the deployment ID. Its worker scans events in event-store order, writes rows in batches, and advances the checkpoint after the batch transaction commits. The worker can start from a chosen position for a partial rebuild, but a production rebuild starts at the beginning of the selected retention range.

When the new table reaches the current relay position, a verifier compares counts, versions, and a sample of totals against the source stream. The operator then pauses the table swap, records the old and new positions, and changes the read-model view in one database transaction. The previous table remains available for one release so an operator can switch the view back if a query or index behaves unexpectedly.

### 9.3 Recovery exercise record

Each recovery exercise records the backup identifier, restore start and finish, database promotion time, event-store row count, relay position, consumer start time, projection position, and first successful API request. The exercise owner signs off each checkpoint in the runbook. A recovery dashboard shows the remaining time against the service objective and marks whether the API is in read-only or normal mode.

The exercise uses an isolated database and production-shaped event payloads. After the cutover check, the team runs a placement, an address correction, a cancellation, and an idempotent retry. It compares the resulting stream versions and projection rows with expected values, then destroys the exercise resources under the normal managed-service retention policy. The evidence is attached to the monthly change record and used to update the capacity estimate.
