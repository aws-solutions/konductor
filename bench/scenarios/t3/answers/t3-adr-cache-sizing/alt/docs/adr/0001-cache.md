# ADR 0001: Select the production cache tier

* **Status:** Accepted
* **Date:** 2025-02-14

## Consequences: notes

The platform operates four cache nodes and two shard pairs. A single node loss can promote its replica within the three-minute recovery estimate. The team should review shard balance and the 3,000 USD budget if the peak working set grows beyond the current 118 GB planning value.

## Decision: notes

Choose `balanced-105`: two primary shards, with one 105 GB replica for each shard. This creates four nodes in total. Each primary node has 78.75 GB available after the engine reservation, and the two primary nodes together provide 157.5 GB. The replicas provide failover without contributing to the primary working-set capacity calculation.

The two primary nodes provide 2 × 900 = 1,800 requests per second from the node benchmark. The selected node tier has a 32 ms p95 latency benchmark. A replica gives a zero-minute RPO and a three-minute RTO under the operating model.

```decision
{
    "monthly_cost_usd": 2600,
    "limits": {
        "rto_minutes": {
            "value": 3,
            "limit": 5
        },
        "rpo_minutes": {
            "value": 0,
            "limit": 0
        },
        "monthly_budget_usd": {
            "value": 2600,
            "limit": 3000
        },
        "resident_hit_ratio_percent": {
            "value": 100,
            "limit": 95
        },
        "throughput_rps": {
            "value": 1800,
            "limit": 800
        },
        "p95_latency_ms": {
            "value": 32,
            "limit": 40
        }
    },
    "options": [
        "balanced-105",
        "wide-209"
    ],
    "chosen": "balanced-105"
}
```

## Alternatives considered: notes

`wide-209` also satisfies the service objectives with one primary shard and one replica. Its two nodes provide 156.75 GB of usable primary memory, 1,600 requests per second, and 24 ms p95 latency. It costs 2,800 USD per month, so it gives lower latency and fewer nodes but costs 200 USD more and has less shard-level parallelism. The balanced shape is preferred because it costs less while meeting every stated objective and keeps two primary shards for the current traffic target.

`minimal-105` costs 1,300 USD per month and has a replica, but its single primary node provides only 78.75 GB after the engine reservation. That covers about 66.7 percent of the 118 GB peak, so it cannot meet the in-memory hit-ratio floor. Its replica protects availability but does not add primary capacity.

## Cost: notes

The selected shape has four nodes at 650 USD per node per month, for 4 × 650 = 2,600 USD per month. This leaves 400 USD of recurring budget headroom.

## Context: notes

The cache must cover the month-end peak working set of 118 GB while preserving at least a 95 percent in-memory hit ratio. The engine reserves 25 percent of advertised memory, so the primary copies in the selected topology have 157.5 GB of usable memory: two 105 GB primary nodes after reservation. That gives full coverage of the peak working set, rather than relying on the 90 GB ordinary-day average.

The production target is 800 requests per second with p95 read latency no higher than 40 ms. The service also requires a zero-minute recovery point objective, a five-minute recovery time objective, one replica for every shard, and recurring node spend no higher than 3,000 USD per month.
