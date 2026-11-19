# Glossary

- **Aggregate**: the order state and the rules that change it.
- **Command**: an authorized request to change an aggregate.
- **Event**: an immutable fact recorded after a command succeeds.
- **Projection**: a read model built by consuming events.
- **Relay**: the process that publishes committed outbox rows to the broker.
- **Snapshot**: a stored aggregate state used to skip older event application.
- **Sequence**: the monotonically increasing position of an event within one order.
- **Freshness**: the age of the newest event not yet represented in a read model.
- **Erasure**: removal or irreversible de-identification of customer-linked data under a deletion request.
