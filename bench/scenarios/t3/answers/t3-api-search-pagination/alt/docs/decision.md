# Product search architecture decision

## Cost calculation: notes

The monthly estimate uses the peak rate as the planning request volume:

`fixed + storage_gb * storage_rate + replicas * replica_rate + peak_rps * 30 * 24 * 3600 / 1,000,000 * request_rate`

For `cursor-index`, that is `4200 + 1200 * 0.28 + 4 * 650 + 1800 * 30 * 24 * 3600 / 1,000,000 * 0.18 = 7975.81 USD` after rounding to cents.

## Comparison: notes

| Option | Deep search p99 | Throughput | Capacity | RPO | RTO | Monthly estimate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `offset-sql` | 4,200 ms | 2,400 req/s | 60,000,000 items | 45 s | 12 min | $5,063.81 |
| `cursor-index` | 180 ms | 2,200 req/s | 80,000,000 items | 30 s | 10 min | $7,975.81 |

The lower-cost option is attractive because it uses the existing store and has enough throughput, capacity, and recovery margin. Its deep request takes 4,200 ms, which exceeds the 250 ms p99 target. The selected option costs more because it has four replicas and more indexed storage, but it remains below the $9,000 monthly budget and meets the latency, throughput, capacity, RPO, and RTO limits.

## Decision: notes

Choose `cursor-index`. It is the only option that keeps a deep traversal within the production latency target while still supporting the crawler use case. The public API exposes a bounded `limit` and an opaque `cursor`; the response returns `next_cursor` when another page is available.

## API behavior: notes

`GET /v1/products/search` accepts `q`, an optional `limit` from 1 through 100, and an optional `cursor`. The server creates the continuation value and returns it as `next_cursor`. The value is opaque: clients store it and send it back unchanged, rather than interpreting a position or storage key. A final page returns a null continuation value. This keeps the contract stable if the index layout changes and avoids asking the service to rescan discarded earlier pages.

The gateway can translate the current `page_size` field to `limit` during migration, while browser and crawler clients change their loop to send `next_cursor` instead of a page number. The contract is in `api/openapi.json`. It keeps response item counts bounded and documents the continuation value in both the request and response schemas.

```decision
{
    "monthly_cost_usd": 7975.81,
    "limits": {
        "rto": {
            "value": 10,
            "limit": 15
        },
        "rpo": {
            "value": 30,
            "limit": 60
        },
        "catalog_capacity": {
            "value": 80000000,
            "limit": 60000000
        },
        "monthly_search_budget": {
            "value": 7975.81,
            "limit": 9000
        },
        "peak_search_throughput": {
            "value": 2200,
            "limit": 1800
        },
        "p99_search_latency": {
            "value": 180,
            "limit": 250
        }
    },
    "options": [
        "offset-sql",
        "cursor-index"
    ],
    "chosen": "cursor-index"
}
```
