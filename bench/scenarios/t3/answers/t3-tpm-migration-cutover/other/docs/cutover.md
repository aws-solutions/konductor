# Payments ledger cutover: recommendation

```decision
{
  "options": ["dual_write", "big_bang_copy", "continuous_replication"],
  "chosen": "continuous_replication",
  "monthly_cost_usd": 4300.0,
  "limits": {
    "monthly_cost_usd": {"limit": 5000, "value": 4300},
    "throughput_mb_s": {"limit": 150, "value": 150},
    "latency_ms": {"limit": 30, "value": 12},
    "rpo_min": {"limit": 5, "value": 2},
    "downtime_min": {"limit": 20, "value": 8}
  }
}
```

**Recommendation: continuous replication.** It is the only option inside all five limits.

| Option | Downtime | RPO | p95 added | Monthly | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| big_bang_copy | 1,800,000 MB / 450 MB/s = 4,000 s = 66.7 min | 0 | 20 ms | 3,200 | fails the 20 min window |
| dual_write | 2 + 3 = 5 min | 0.5 min | 22 ms | 2,400 + 1,200 + 300 + 2,800 = 6,700 | fails the 5,000 ceiling |
| continuous_replication | 3 + 5 = 8 min | 2 min | 12 ms | 2,400 + 1,200 + 300 + 400 = 4,300 | passes |

Dual write is the best on recovery. It would win only with a ceiling of at least 6,700 USD. It also writes one ledger
entry to two databases with no shared commit, which is a second risk.

## What we live with

- **No throughput margin.** The replication path is held to the 150 MB/s business-hours cap, which is exactly the
  minimum. The application already writes about 90 MB/s, so only about 60 MB/s is left for the initial seed.
- **Seed lead time.** At 60 MB/s spare, 1.8 TB takes about 8.3 hours. The seed starts the day before; it cannot start
  at 02:00 Sunday.
- **Rollback window.** The rollback point is the source's last confirmed consistent position. Writes the target takes
  after the switch are not on the source, so after the first new write a rollback loses them unless we replicate back.

## Handoff, in order

1. Go only if replication lag is under 120 s for 15 minutes and p95 added latency is at most 12 ms.
2. Reject writes; the coordinator starts the clock at the first rejection.
3. Record the source position and wait until the target confirms it (budget 3 min).
4. Switch the writer endpoint and run the target health check (budget 5 min). Over 8 minutes in total: roll back.
5. Accept writes on the target and stop the clock.

The 400 USD migration support line stops when the migration ends. One-time labour is not in the monthly figure.
The 2.4 TB and 300 MB/s staging figures are not used.
