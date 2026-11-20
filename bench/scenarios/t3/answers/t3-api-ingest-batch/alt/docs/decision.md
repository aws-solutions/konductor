# Decision: bounded batch intake

## Alternatives: notes

* **direct-large-batch** is the simplest and cheapest option in the estimate, but its 1,000-reading request would be 380,512 bytes. That exceeds the production gateway ceiling even though its other operating figures meet the targets, so it is not a viable production choice.
* **replicated-stream** has the strongest latency and recovery figures and stays within the body limit with 64-reading batches. Its extra workers, storage, and replication charge bring it close to the monthly ceiling. It is a reasonable higher-resilience alternative, but it spends more than the selected design without being required by the stated RPO and RTO.

The buffered design is sized for 6,000 readings per second, has a 420 ms p99 target, a 30-second RPO, and a 10-minute RTO. A 207 response reports each reading as accepted, rejected, or deferred, and the status resource exposes remaining deferred items and failures. Clients send `Idempotency-Key` on each batch so a timeout can be retried safely.

## Context: notes

The fleet produces 40,000 / 10 = 4,000 readings per second. A production request may contain 380-byte readings, but the gateway permits at most 262,144 bytes and the batch envelope needs 512 bytes. The batch therefore needs a bounded array rather than the pilot's obsolete 1 MiB assumption.

The selected design is **buffered-batch**. It accepts up to 688 readings, places accepted input on a durable queue, and records an item-level outcome. The envelope calculation is 512 + (688 × 380) = 261,952 bytes, leaving 192 bytes of gateway headroom. The queue and idempotency record let a retry return the same batch identity without duplicating readings.

## Cost: notes

Using the price sheet and the buffered option's steady-state quantities, the monthly estimate is **$1,217.25**. This is below the $1,500 service budget. The cost includes gateway requests, queue readings, workers, storage, backups, database writes, and monitoring.

```decision
{
    "monthly_cost_usd": 1217.249302,
    "limits": {
        "rto_minutes": {
            "value": 10,
            "limit": 15
        },
        "rpo_seconds": {
            "value": 30,
            "limit": 60
        },
        "monthly_budget_usd": {
            "value": 1217.249302,
            "limit": 1500
        },
        "throughput_readings_per_second": {
            "value": 6000,
            "limit": 4000
        },
        "p99_latency_ms": {
            "value": 420,
            "limit": 500
        },
        "max_request_body_bytes": {
            "value": 261952,
            "limit": 262144
        }
    },
    "options": [
        "buffered-batch",
        "direct-large-batch",
        "replicated-stream"
    ],
    "chosen": "buffered-batch"
}
```
