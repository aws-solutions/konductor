# Architecture overview

Ledgerline runs a regional payments API, a relational ledger, and a worker pool. A transaction writes its ledger change and an outbox record in one database transaction. The outbox poller publishes internal events to the message broker.

The broker is partitioned by account today, but the worker may process partitions concurrently. The current module does not persist a public event identifier or a delivery attempt. There is no outbound HTTP client in the service.

The proposed webhook component should sit after the outbox and should not make a customer-facing API request wait for an external endpoint. The platform team has not chosen a queue retention policy or a customer-facing delivery contract.
