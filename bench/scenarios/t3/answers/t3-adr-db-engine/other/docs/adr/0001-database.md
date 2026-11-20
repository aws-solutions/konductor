# ADR 0001: Launch-day session store

Status: proposed. Decision: **kv-provisioned-autoscaling**.

## The hot key decides it

Launch peak is 25,000 writes/s and 60% of them land on the hot keys: 15,000 writes/s. Spread over 8 partitions that is
1,875 WCU per partition for on-demand, nearly twice the 1,000 WCU partition ceiling. On-demand is the cheapest option,
but it would throttle the hot keys at launch.

Provisioned capacity writes each hot key through two shards: 15,000 / 16 = 937.5 WCU per partition. That fits, but only
just: 94% of the ceiling. If the hot share rose above 64%, or peak above about 26,700 writes/s, it would break.

## Options

| | kv-on-demand | kv-provisioned-autoscaling | relational-cluster |
| --- | ---: | ---: | ---: |
| Hot partition | 1,875 WCU (fails) | 937.5 WCU | n/a |
| Read p99 | 12 + 1 = 13 ms | 9 + 2 = 11 ms | 7 + 1 = 8 ms |
| RPO / RTO | 60 s / 240 s | 45 s / 240 s | 30 s / 180 s |
| Monthly | about 4,965 USD | 6,540 USD | 8,075 USD (over 7,000) |

Relational is strong on every line but cost: 4 nodes x 730 h x 2.75 = 8,030, plus 45 for storage and backup, is
8,075 USD against a 7,000 USD budget.

## Cost of the choice

- Steady writes: 3,000 WCU x 700 h = 2.1 M WCU-h; launch: 30,000 WCU x 30 h = 0.9 M WCU-h; 3.0 M x 0.0018 = 5,400
- Reads: 5,000 RCU x 730 h x 0.0003 = 1,095
- Storage 100 GB x 0.25 = 25 and backup 200 GB x 0.1 = 20
- Total 6,540 USD a month

## Consequences

- The 30,000 WCU launch capacity is scheduled before launch, not left to reactive scaling. Each hour past the
  30-hour window costs about 48.60 USD.
- The app routes hot-key writes over two shards and reads fan in across both (the extra 2 ms).
- We watch shard skew and rehearse at 25,000 writes/s before launch.
- A budget near 8,100 USD would make relational the better choice.

```decision
{
  "monthly_cost_usd": 6540.0,
  "chosen": "kv-provisioned-autoscaling",
  "options": ["relational-cluster", "kv-on-demand", "kv-provisioned-autoscaling"],
  "limits": {
    "partition_write_wcu": {"limit": 1000, "value": 937.5},
    "rto_seconds": {"limit": 300, "value": 240},
    "rpo_seconds": {"limit": 60, "value": 45},
    "item_size_bytes": {"limit": 1024, "value": 1024},
    "monthly_budget_usd": {"limit": 7000, "value": 6540},
    "read_p99_ms": {"limit": 15, "value": 11},
    "peak_write_wps": {"limit": 25000, "value": 30000}
  }
}
```
