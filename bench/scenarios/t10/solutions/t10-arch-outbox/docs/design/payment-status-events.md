# Payment status delivery

## Context

A status update currently changes the order and then calls the broker. A process exit between those operations loses the notification, while a caller retry can publish the same transition twice. The existing JSON store and broker remain the boundaries; this change does not add a package or a second persistence system.

## Decisions

A status change writes the new order and one status-events record through one `store.atomicWrite` call. The record contains a generated `id`, the topic, order and status, UTC `occurredAt`, and a compact payload. Repeating an already applied status is a no-op, so the same transition does not create another record. Existing records without a statusEvents collection are treated as an empty collection.

The publisher uses a persisted 30-second claim window and instance ID for each due record. It selects the oldest unsent record for each order, and can process up to four different orders at once. It never selects a later record for an order while an earlier one is unsent. A successful publish is followed by an atomic sent mark. The `id` remains unchanged across attempts and is sent in the `x-event-id` header. The broker's 2048-byte limit is enforced before publish.

Failures clear the claim, increment attempts, and schedule the next try after 1, 2, 4 seconds and so on. After five failed attempts the record is retained as a dead letter with the error and is surfaced by publisher results; it is never silently deleted. A publish timeout is 250 milliseconds. This is at-least-once delivery: a crash after broker acceptance and before the sent mark can cause a duplicate, which the consumer's header-based deduplication handles.

The scheduler is only a per-instance trigger, so both production instances run the publisher and the persisted claim prevents simultaneous work. Per-order ordering is required; global ordering is intentionally not imposed because unrelated orders can be delivered concurrently.

## Cut-over

Deploy the reader and publisher code to orders-a first with the publisher disabled, then deploy orders-b with the same code and disabled publisher. Enable the publisher on orders-a, verify it, and enable it on orders-b. Before enabling, both versions read the old file format with a missing statusEvents as empty. Status writes use the new atomic path as soon as the first new instance handles them. No old publisher is left active during the switch, so an in-flight status is either in the old publish path before drain or in the new atomic path after drain. Drain orders-a's old workers before enabling its publisher and keep the file backup until the backlog is zero.

## Risks and operations

A poison event can remain pending, so dead letters and broker errors need an operator response. A large payload is retained and dead-lettered rather than repeatedly rejected. Monitor the existing `broker.published`, `broker.errors`, and `status.lag` metrics. The publisher does not invent a new metric name.

```json
{
  "decisions": [
    {"topic":"persistence","choice":"write the order and status event together with store.atomicWrite","reason":"one file replacement prevents a saved status from existing without its event"},
    {"topic":"publisher","choice":"a publisher uses persisted claims between two instances, retries with exponential backoff, and processes up to four different orders concurrently","reason":"the scheduler runs per instance and two instances need persisted ownership while independent orders need throughput"},
    {"topic":"ordering","choice":"select only the oldest unsent event for each order, without global ordering","reason":"consumers require per-order order and unrelated orders can proceed independently"},
    {"topic":"identity","choice":"persist one event id and send it in the x-event-id header on every attempt","reason":"a retry or crash after acceptance must be deduplicable"},
    {"topic":"unpublishable","choice":"retain failures, back off, then mark after five attempts as dead letters with the error","reason":"the broker size limit and poison payloads must not cause silent loss"},
    {"topic":"cut-over","choice":"deploy both instances with publishing disabled, drain the old publisher, then enable each publisher and verify the backlog","reason":"the ordered switch leaves no status in an unowned gap"}
  ],
  "risks": [
    {"risk":"a crash after broker acceptance and before sent marking duplicates a message","mitigation":"keep the stable header id and rely on consumer deduplication"},
    {"risk":"a poison or oversized event blocks later events for its order","mitigation":"bounded retries, a retained dead-letter state, and an operator alert"},
    {"risk":"two publisher instances claim the same record","mitigation":"persisted claims and expiry checked in the atomic store write"}
  ],
  "evidence": ["docs/broker-contract.md:3","docs/consumers.md:3","src/scheduler.js:2","ops/metrics.csv:8","ops/instance-deploy.json:1"]
}
```
