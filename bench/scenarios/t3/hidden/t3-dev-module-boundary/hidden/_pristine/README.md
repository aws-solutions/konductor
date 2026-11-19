# Delivery service context

This small service receives application events, records an outbound webhook attempt, and schedules another attempt after a recipient returns a retryable status. The service currently runs one application container per shard and already has a relational database and an append-only ingress journal.

The retry scheduler must be bounded. It should avoid making the request handler wait for the recipient and should expose enough state for operators to inspect overdue deliveries. The production container profile is the source of truth; the older staging profile with 768 MB of memory was superseded when the production profile was standardized.

The team prefers a design that can be introduced behind the existing scheduler interface. A database table, a managed queue, and a process-local delay structure are all technically available, but their operational and failure behavior differs. See the other fixture files for the measured profile, recovery objectives, and prices.
