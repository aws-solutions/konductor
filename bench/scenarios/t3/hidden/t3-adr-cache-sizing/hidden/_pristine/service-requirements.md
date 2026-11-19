# Service requirements

The cache is a production dependency for request assembly. The SRE review set the following objectives for the production tier. Measurements use the calendar-month peak rather than a quiet-day sample.

| Service objective | Target | Measurement note |
| --- | ---: | --- |
| p95 cache-read latency | 40 ms maximum | Measured at the cache client |
| Monthly infrastructure spend | 3,000 USD maximum | Recurring node spend only |
| Recovery point objective | 0 minutes maximum | A failed node must not lose the current cache copy |
| Recovery time objective | 5 minutes maximum | Time to restore service after one node loss |
| In-memory hit-ratio floor | 95 percent minimum | Applies to the peak working set |

The platform review also requires one replica for every shard. A replica may be promoted after a node failure, so a shape with no replica is not a production candidate even if its monthly estimate is attractive.
