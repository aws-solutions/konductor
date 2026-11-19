# Reliability and continuity notes

The booking store is replicated between two regions. The business owner accepts a recovery point objective of **5 minutes** for a confirmed booking and a recovery time objective of **30 minutes** for the public API. A response can be retried after a regional failover, but the create operation still needs its idempotency key so a retry does not create a second booking.

The production traffic profile peaks at **240 requests per second**. The capacity figures in `traffic.json` are the tested sustained rates for each pagination design. The list latency measurements there are p95 values from the same load profile.

The production continuity targets are split from the traffic measurements in the review worksheet:

| Continuity measure | Production target | Applies to |
| --- | ---: | --- |
| Recovery point objective | 5 minutes maximum | confirmed bookings |
| Recovery time objective | 30 minutes maximum | public API |
| Peak sustained capacity | 240 requests/second minimum | production traffic |

The sandbox uses a separate recovery drill configuration. Its settings are not production acceptance criteria and are retained only to explain why local demonstrations may use a smaller deployment.
