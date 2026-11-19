# Service targets

The order API is a tier-one customer path. The service objective is an RTO of 15 minutes and an RPO of five minutes for a regional loss. A quarterly recovery exercise measures time from selecting the backup through accepting customer traffic, including any data rebuild needed by the service.

The API target is 99.95% monthly availability. A successful write should be acknowledged within 750 ms at the p95, and a read should complete within 400 ms at the p95. During recovery, a degraded read-only mode is acceptable for up to five minutes while writes are fenced.

The current PostgreSQL restore exercise takes 11 minutes at the present database size. The exercise includes replaying the write-ahead log and promoting a restored instance. The order team has one primary on-call engineer and a shared platform escalation during business hours; a recovery procedure must be executable by the on-call rotation.

The platform budget for new order persistence in the first year is 2,400 USD per month. Storage and transfer are charged to the service. The budget can grow with an approved capacity plan, but an unbounded rebuild step is not an acceptable operating assumption.
