# ADR 0001: Deliver published clips through a committed CDN

- **Status:** Accepted
- **Date:** 2025-02-14
- **Decision owners:** Platform architecture and media operations

## Context

The production forecast is 180 TB of clip delivery per month. The viewer-facing service must keep p95 request-to-first-playable-byte time at or below 800 ms, sustain at least 1.5 Gbps, stay within USD 9,500 per month, and recover within the documented RPO and RTO. The comparison uses the measured regional performance data and the incremental billing tiers in the input packet.

## Options and cost comparison

All prices use 1 TB = 1,000 GB. The committed plan costs USD 6,800 for 150 TB. The remaining 30 TB costs 30,000 GB × USD 0.045 = USD 1,350, and request and delivery charges add USD 450. The committed option therefore costs **USD 8,600 per month**.

| Option | Monthly calculation | Monthly cost | p95 start | Sustained rate | RPO / RTO |
| --- | --- | ---: | ---: | ---: | --- |
| `cdn-committed` | 6,800 + 1,350 overage + 450 delivery charges | USD 8,600 | 620 ms | 2.4 Gbps | 10 / 20 min |
| `cdn-payg` | 200 + 1,120 + 3,600 + 1,350 tiered egress + 550 charges | USD 6,820 | 780 ms | 1.6 Gbps | 15 / 25 min |
| `object-direct` | 120 + 1,600 + 5,500 + 1,800 tiered egress + 180 charges | USD 9,200 | 1,400 ms | 1.8 Gbps | 15 / 30 min |

The direct option's first 10 TB rate is attractive, but the incremental rows must be applied to their own ranges. Its 1,400 ms p95 measurement misses the 800 ms viewer limit. The usage-based CDN is cheaper and passes the stated limits, but its 780 ms result leaves only 20 ms of measured latency headroom and its throughput margin is smaller. The committed plan buys more latency and throughput headroom while remaining USD 900 below the budget.

## Decision

Adopt `cdn-committed` as the public delivery path. Cache immutable clips at the CDN edge, retain the object store as the origin, and monitor p95 start time, sustained throughput, monthly egress, RPO, and RTO against the limits. Revisit the commitment if the rolling three-month volume falls materially below 150 TB or if the CDN's measured headroom changes.

```decision
{
  "chosen": "cdn-committed",
  "options": ["cdn-committed", "cdn-payg", "object-direct"],
  "limits": {
    "p95_start_ms": {"limit": 800, "value": 620},
    "sustained_throughput_gbps": {"limit": 1.5, "value": 2.4},
    "monthly_cost_usd": {"limit": 9500, "value": 8600},
    "data_size_tb": {"limit": 180, "value": 180},
    "rpo_minutes": {"limit": 15, "value": 10},
    "rto_minutes": {"limit": 30, "value": 20}
  },
  "monthly_cost_usd": 8600
}
```

## Consequences

The platform adds CDN configuration, cache invalidation monitoring, and a committed monthly charge. In return, viewers get measured latency headroom, the origin serves fewer bytes directly, and the service has a clearer operating margin against the throughput and recovery requirements.
