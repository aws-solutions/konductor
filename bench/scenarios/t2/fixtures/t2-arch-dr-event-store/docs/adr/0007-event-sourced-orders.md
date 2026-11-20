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

### 3.2 Contract

Events are facts and are never updated in place. Initial event types are `OrderPlaced`, `AddressChanged`, `LineQuantityChanged`, and `OrderCancelled`. The payload contains the complete values needed by the aggregate, including customer ID, delivery address, line identifiers, quantity, and price. This makes replay independent of the current order tables.

The first event contract will be documented in the repository and reviewed by the order team. New optional fields can be added with defaults, and event consumers will ignore fields they do not recognize. A serializer test will protect the field names and JSON types. Events will be retained for the life of the service so any projection can be rebuilt from the source history.

### 3.3 Request result

Projection workers consume events asynchronously and write `order_summary` and `support_order` rows. They checkpoint their event position and retry failed records with exponential backoff. A freshness gauge will show the age of the newest event not yet applied. A projection can be rebuilt in a separate table and swapped after it catches up.

After a command commits, the API returns the receipt and order identifier. The customer detail and list endpoints read the customer projection, which normally catches up within two seconds. If a projection is behind, the API returns the last available row with its version and the client can request the detail again. This keeps command latency independent of projection work and avoids making every read a transaction against the event table.

Support changes use the version from the support projection. The command handler rejects an old version with a conflict and the console reloads the row. For a new order, the customer projection is populated by the same worker path as any other order, and the existing mobile and web clients need no changes.

### 3.4 Boundaries

The event store is backed up with the same continuous backup policy as the current database. A regional recovery starts a PostgreSQL restore, promotes the instance, starts the relay, and starts the customer and support workers. The recovery procedure keeps command traffic fenced until the restored source and the required read models have passed their validation checks.

A recovered projection is validated against its event position and a sample of order totals before customer traffic is opened. A projection can be rebuilt in a separate table and swapped after it catches up. The event store remains authoritative throughout the process, so a derived view can be regenerated without changing the accepted history.

The design keeps recovery mechanics separate from normal command handling. During a planned rebuild, the service can continue accepting commands against the event store after the operator records the historical cutover position, and workers process those new events after the backlog. The runbook defines restore, verification, worker startup, and traffic cutover as separate actions.

### 3.5 State

The event payload contains the values needed by the aggregate, including the customer identifier, delivery address, line identifiers, quantity, and committed price. A command event also carries the actor reference, correlation ID, and occurrence time so the source history can be joined to operational investigations. Domain rules never depend on the current shape of a projection.

The customer projection carries the fields needed by the detail view, while the support projection retains the actor and reason supplied with a support command. Both views carry the source stream version. This keeps read-model changes independent from the command schema and gives conflict responses a stable version to report.

The event store, projections, and broker envelope use the same order ID and event ID. A projection may omit fields that it does not display, but it records the source position needed to explain which event produced its current row.

### 3.6 Scope

The first release covers placement, address correction, line quantity changes, and cancellation. It keeps the existing HTTP endpoints, idempotency behavior, conflict status, fulfillment message shape, PostgreSQL deployment, and broker. Returns, exchanges, and a new database vendor remain outside this change.

The command model owns one order aggregate at a time. Pricing and address validation remain calls to their existing services, and fulfillment remains a downstream consumer of the relay. Customer and support projections are the first read models; additional views can be introduced without changing the event append transaction.

The team will use the same workload identity, backup controls, and change gates as the existing service. This scope keeps the migration small enough for the current rotation while establishing the event stream as the source for the selected order commands.

### 3.7 Reconstruction

An aggregate is reconstructed by reading its events in sequence and applying the domain rules for the event type. The stream version is checked before a command appends new facts, so a stale command cannot silently replace a newer state. Orders with different identifiers can be loaded and changed concurrently.

The command handler treats malformed or unknown records as a stopped stream rather than inventing a state. It records the order ID, event position, and correlation ID for an operator, and the recovery procedure can restore the source before retrying the load. Projection workers use their own checkpoints and do not change the aggregate's source sequence.

Read models carry a source position and can be rebuilt independently. The source event shape stays separate from the query indexes, so adding a customer list field or a support filter does not require rewriting the command transaction.

### 3.8 Delivery

The relay reads committed event rows and publishes the existing integration messages. Fulfillment continues to receive the current placement shape, and downstream consumers use the event ID as their idempotency key. The order service records the publication cursor so a relay restart can resume without losing committed facts.

The internal event envelope carries order ID, event ID, stream version, event type, occurrence time, and correlation ID. Integration messages are mapped from the envelope rather than exposing the internal JSON payload directly. This gives the team a stable boundary for the first downstream migration.

The customer and support workers consume the same committed history through their projection subscriptions. A failed delivery is retried according to the existing broker policy, and an operator can inspect the consumer position before resuming it.

## 4. Data model and consistency

### 4.1 Persistent structures

The `order_events` table stores one row per event and is partitioned by event month. The aggregate key remains the order UUID. `order_streams` stores the current version and a pointer to the latest snapshot. `command_receipts` stores the idempotency key, command result, and expiration timestamp. A receipt is returned for a retry even when the original response was lost.

The customer projection includes the customer ID, order number, status, totals, and a projection version. The support projection includes the same order state plus the last actor and reason. Projection writes use an event ID uniqueness constraint so a worker restart does not apply a record twice.

Snapshots will be used for long-lived orders so the command handler does not apply every event on every load. A snapshot contains aggregate state, the last applied sequence, and a format marker. Snapshot records are derived data associated with an order; a corrupt or old snapshot can be bypassed and rebuilt from the stream.

The implementation will choose the snapshot interval during the schema spike based on observed stream lengths. Snapshots are expected to live in PostgreSQL beside the event table and will be covered by the existing database backup.

### 4.2 Ordering and conflicts

Commands for one order are serialized by the stream version. A command with an expected version that is not current fails without appending an event. Events for different orders can be appended concurrently. The relay preserves the order of events within an order when it publishes integration messages.

The API rejects a duplicate idempotency key if it is associated with a different command body. A client may safely retry the same body after a timeout. Fulfillment receives the placement message once logically, even if the broker sees a duplicate delivery.

## 5. Migration plan

### 5.1 First release

Before backfill, we considered keeping the current CRUD model, adopting event sourcing as described here, or moving to a hosted event database. The current CRUD model has a simple read path but does not provide a complete history or a clean way to rebuild new views. A hosted event database provides stream operations but adds a second operational platform and a new backup contract. Event sourcing in PostgreSQL gives us history while keeping the existing team and recovery tools.

The comparison is:

| Option | History | Read path | Operations | Migration |
| --- | --- | --- | --- | --- |
| Current CRUD tables | Current state only | Simple SQL | Familiar | Lowest |
| Event-sourced PostgreSQL | Complete event stream | Projections | Existing database plus workers | Moderate |
| Hosted event database | Complete event stream | Projections | New vendor | Highest |

The event-sourced design wins because history and projection rebuilds matter more than the extra worker.

We will first create the event table and projection schemas. A one-time converter will read each current order and its audit rows, create an `OrderPlaced` event plus subsequent events where the old audit row contains enough information, and record the source row identifier. Orders without a detailed old value will receive a state capture event so their current behavior remains available.

For new writes, a feature flag will route a small customer cohort to the event command handler. During the first stage, the handler will write the legacy tables from the customer projection for compatibility. The relay will continue to publish existing fulfillment messages. We will compare status, totals, and version values between the two representations before expanding the cohort.

### 5.2 Transition

The migration has four gates: backfill completeness, projection parity, latency at the target percentile, and successful recovery exercise. The migration dashboard will show command errors, version conflicts, relay lag, projection freshness, and event-to-table differences. The order team will expand from internal accounts to five percent, then 25 percent, then all customers.

A flag can route commands back to the legacy handler before the event path becomes authoritative. Once the event store is authoritative, rollback means keeping the event path and rebuilding the legacy compatibility tables from the projection; no writes will be sent to two independent authorities. The team will retain the legacy tables for one release after full cutover.

The reporting team will no longer read mutable order tables after the migration. The reporting projection will expose current order state, line items, status transitions, actor identifiers, and event timestamps. A reporting API can serve ad hoc questions, while scheduled reports can consume a daily export of the projection. This removes direct database access from reporting and prevents analytical queries from competing with command traffic.

The projection can be indexed for the report shapes, and a separate worker can publish a compact report feed to the warehouse. Existing fulfillment messages continue to use their current contract.

## 6. Operations

### 6.1 Monitoring and alerts

Dashboards will cover append latency, command failures, version conflicts, event-store growth, relay lag, projection freshness, projection error rate, and snapshot use. Alerts will fire when the customer projection is more than 30 seconds behind, when a consumer stops advancing, or when the event append p95 exceeds the API target.

Workers will expose a dead-letter count and a retry age. An operator can pause a projection, inspect a failed event, and resume from its checkpoint. Rebuilds will use a separate table and a named cutover operation so an incomplete rebuild does not replace a healthy projection.

### 6.2 Operating envelope

The event table will grow with order activity and event history. Partitioning and indexes will be reviewed monthly. PostgreSQL storage, backup storage, broker traffic, and worker compute will be included in the service budget. The first capacity test will use the projected next-year event count and a two-times burst for checkout.

A staging benchmark replayed a representative stream at 2.5 million events per minute. The current event count is approximately 174.7 million, so the design estimates a full replay at about ten minutes, followed by five minutes for restore and startup. The total fits the 15-minute recovery objective. A future year's projected event count is expected to remain within the same operating envelope because the workers can be scaled horizontally.

The order team will own the application dashboards and replay commands. Platform will own the managed database and broker. The on-call runbook will document how to fence commands, restore the database, start consumers, and verify projection positions before traffic is opened.

## 7. Security and compliance

### 7.1 Access controls

Only the order service can append events. Projection workers have read access to the event stream and write access to their own schemas. The recovery role is separate and requires an approved emergency access grant. Reporting receives only the fields in its projection, not the raw event table.

All service-to-service calls use the existing workload identity. Database connections use TLS, and secrets remain in the managed secret store. Audit records include actor, command, correlation ID, and result. Operators will not place event payloads in request logs.

### 7.2 Records

An event is an accepted domain fact, not a statement that every downstream view has caught up. The support console will show the event version and actor for a completed command. Corrections are represented as new facts rather than edits to old facts, which lets investigators explain the order's history.

The event payload includes the customer identifier and the delivery address because those values are required to reconstruct an order and to explain a support action. It may also include the recipient name and contact details when the shipping destination differs from the account. The event log is append-only and is retained indefinitely as the source of truth.

The deletion worker will delete customer rows from the customer projection and remove the customer from search indexes. Support and reporting projections will receive the same deletion notification. The immutable event stream remains available for reconstruction and audit, while normal API responses will no longer find the deleted customer record.

Access to the event table is limited to the order service role and the recovery role. Payloads are encrypted at rest, and application logs will use order IDs rather than full event bodies. The event history gives support a reliable account of who changed an order and when.

## 8. Rollout decision

The team recommends approval for a two-week schema and throughput spike followed by the staged migration. The spike will validate aggregate commands, the relay, projection rebuild, and the recovery runbook using production-shaped data. It will also produce the first capacity estimate for storage and workers.

The architecture is preferable to adding more mutable tables because it gives the order service one history and independent read models while retaining PostgreSQL and the current broker. The public API stays stable, the migration can be gated, and a projection can be recreated when reporting or customer views change. With the rollout gates and operational dashboards above, the team considers this proposal ready to implement.

## 9. Appendix: implementation sketch

### 9.1 Placement request

The handler authenticates the customer, validates the cart, and creates a command with a correlation ID and idempotency key. The gateway checks for an existing receipt, loads the aggregate, applies rules, appends facts, inserts the receipt, and commits both records in one transaction. Validation failures append no event; stale versions return a conflict.

The response mapper preserves the existing order number, status, totals, and links.

### 9.2 Projection deployment

A new projection starts with a schema version, empty checkpoint, and deployment-specific table. Its worker applies batches and advances the checkpoint only after commit. A verifier compares counts, versions, and sample totals at the relay position before a database transaction swaps the read-model view. The previous table remains for one release.

### 9.3 Recovery exercise record

Each exercise records restore and promotion times, event count, relay and projection positions, consumer startup, and the first successful API request. The team runs placement, address correction, cancellation, and idempotent retry against an isolated production-shaped database, then attaches the evidence to the change record.