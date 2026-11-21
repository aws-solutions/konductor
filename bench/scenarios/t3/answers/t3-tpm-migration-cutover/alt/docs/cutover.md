# Ledger move: how we cut over

We will cut over with `continuous_replication`. The table below checks each option against the limits in the packet.

| Option | Write pause | Monthly cost | Verdict |
| --- | --- | --- | --- |
| big_bang_copy | 1,800,000 MB / 450 MB/s = 4,000 s, about 67 min | lowest | fails the 20-minute downtime limit |
| dual_write | short | 2,400 + 1,200 + 300 + 2,800 = 6,700 USD | fails the 5,000 USD ceiling; also no shared commit across two ledgers |
| continuous_replication | 8 min | 2,400 + 1,200 + 300 + 400 = 4,300 USD | meets every limit |

What we live with: the replication path runs at exactly the 150 MB/s floor, so there is no throughput margin at all. The answer flips if finance allows 6,700 USD or more a month (then dual_write fits), or if the data shrinks below about 0.54 TB (then a big-bang copy fits in 20 minutes at 450 MB/s).

The monthly sums leave out one-time implementation labor, as cost-notes.md asks. They keep the 400 USD migration support line, because it is billed every month while the migration runs.

## Before Sunday

The full copy cannot happen in the window. While customers are on, the app uses 90 MB/s of the 150 MB/s cap, which leaves about 60 MB/s. At that rate 1.8 TB needs roughly 8.3 hours (it would take about 67 minutes off hours). So the seed starts on Saturday afternoon, at the latest 17:00, and runs into replication before 02:00.

## Sunday 02:00 runbook

1. Check the target: schema matches, row counts match, replication lag under 120 s.
2. Pause acknowledged writes and note the source position. This is the rollback checkpoint.
3. Wait for the target to confirm that position. If 8 minutes pass first, abort: resume writes on the source.
4. Point the writer at the target and run the health checks. From here on, rolling back loses whatever the target accepted, unless it is copied back to the source. This is the point of no return.
5. Resume writes. Keep the source untouched until validation is done. Watch the recovery point (at most 2 minutes) and the added p95 latency (at most 12 ms).

```decision
{"chosen":"continuous_replication","options":["big_bang_copy","continuous_replication","dual_write"],"limits":{"downtime_min":{"limit":20,"value":8},"rpo_min":{"limit":5,"value":2},"latency_ms":{"limit":30,"value":12},"throughput_mb_s":{"limit":150,"value":150},"monthly_cost_usd":{"limit":5000,"value":4300}},"monthly_cost_usd":4300}
```
