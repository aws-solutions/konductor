# Status event contract

Status events are delivered from the fulfillment queue. Every event has an immutable `eventId`, `orderId`, `occurredAt`, `fromStatus`, and `toStatus`. The consumer can receive an event again after a visibility timeout or process a redelivery following a worker restart.

A transition is accepted only when the stored status is the event's `fromStatus` or when the event has already been recorded. An event that has already been applied produces an idempotent success. An event with an unexpected current status is sent to the dead-letter queue for operator review.

The fulfillment console reads the current order status and the per-day status counts. The count is used for workload sizing and may be corrected by a reconciliation run. The console does not display a historical event list.

The queue policy allows five receives with a 90-second visibility timeout. Consumer metrics distinguish an applied event, an already-applied event, a rejected transition, and a dead-lettered event.
