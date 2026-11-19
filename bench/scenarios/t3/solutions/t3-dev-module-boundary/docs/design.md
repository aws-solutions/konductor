# ADR: Store webhook retries in a database table

## Decision

Choose the database-backed retry table. The service already operates a relational database, so this option adds durable retry state without introducing another service or changing the request path. A poller can claim due rows in bounded batches, and an index on the due time keeps the scheduler work separate from payload delivery.

```decision
{
  "chosen": "database_retry_table",
  "options": [
    "in_memory_delay_queue",
    "database_retry_table",
    "external_retry_queue"
  ],
  "limits": {
    "memory_mb": {"limit": 312, "value": 40.096},
    "latency_p95_seconds": {"limit": 60, "value": 42},
    "throughput_per_second": {"limit": 100, "value": 180},
    "payload_kb": {"limit": 16, "value": 8},
    "monthly_budget_usd": {"limit": 300, "value": 104.54},
    "rpo_minutes": {"limit": 5, "value": 1},
    "rto_minutes": {"limit": 30, "value": 18}
  },
  "monthly_cost_usd": 104.54
}
```

## Capacity calculations

The database option keeps 512 records in the worker batch. Using the decimal units in the traffic profile, the retry scheduler's estimated memory is:

`36 MB base + (512 records * 8 KB / 1,000) = 40.096 MB`.

That is below the 312 MB retry memory allowance. The 8 KB payload is below the option's 32 KB supported payload size and the production maximum of 16 KB. Its measured p95 dispatch latency is 42 seconds and its sustained rate is 180 attempts per second, so both runtime targets have margin.

The monthly estimate follows the supplied price sheet:

`(2 * $52) + (1.2 * $0.22) + (3 * $0.08) + (8 * $0.005) = $104.544`, reported as `$104.54`.

The table is durable and can replay from the ingress journal. The stated recovery profile is a one-minute recovery point and an 18-minute recovery time, within the five-minute and thirty-minute objectives.

## Alternatives

The in-memory delay queue has the smallest direct bill and the lowest stated latency. At the production peak it would retain `120,000 * 8 KB / 1,000 = 960 MB` of payloads, which exceeds the 312 MB retry allowance. It is therefore unsuitable for the production envelope even though its other listed measurements fit.

The external retry queue has stronger latency and throughput figures. It also fits the memory, recovery, payload, and budget limits. Its estimated monthly price is `(2 * $52) + (1 * $0.30) + (8 * $0.015) = $104.42`. The small price difference does not offset the added broker access policy, runbook, and restore-drill work when the existing database meets the requirements.

## Follow-up safeguards

The implementation should claim rows with a lease, keep the payload in the row or a referenced blob, and delete or reschedule only after the delivery result is recorded. It should alert on oldest due age, claim failures, and retry-table growth. A load test should verify the 180-attempts-per-second figure with the 512-record batch before production rollout.
