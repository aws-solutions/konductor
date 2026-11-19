# Database migration cutover decision

## Decision

Use `continuous_replication`. Seed the 1.8 TB database before the maintenance window, keep changes flowing while the source serves traffic, and pause acknowledged writes only for the final handoff. The target must report a confirmed replication position before writes resume.

The three considered options are `big_bang_copy`, `continuous_replication`, and `dual_write`. A big-bang copy is simple and has the lowest recurring charge, but copying 1,800,000 MB at 450 MB/s takes 4,000 seconds, or 66.7 minutes, which exceeds the 20-minute user-visible window. Dual-write keeps the pause short but adds an application-side recurring charge that takes the monthly total above the 5,000 USD ceiling. Continuous replication costs 4,300 USD per month and keeps the final pause to 8 minutes.

## Handoff plan

1. Start the seed outside customer impact and verify the target schema and row counts.
2. Enable continuous replication and watch the confirmed source position, business-hours throughput, replication lag, and p95 request latency.
3. Before the window, confirm that the target is caught up enough to keep the recovery point at or below 5 minutes.
4. Pause acknowledged writes, record the source position, wait for the target to confirm that position, and switch the writer endpoint.
5. Resume writes only after target health checks pass. Keep the source at the rollback checkpoint until post-cutover validation completes.

The operating checks are a maximum 8-minute write pause, a maximum 2-minute steady-state recovery point, no more than 12 ms of added p95 latency, and at least 150 MB/s on the business-hours replication path. The recurring charge is the target cluster (2,400), replication service (1,200), observability (300), and migration support (400), for 4,300 USD per month.

```decision
{"chosen":"continuous_replication","options":["big_bang_copy","continuous_replication","dual_write"],"limits":{"downtime_min":{"limit":20,"value":8},"rpo_min":{"limit":5,"value":2},"latency_ms":{"limit":30,"value":12},"throughput_mb_s":{"limit":150,"value":150},"monthly_cost_usd":{"limit":5000,"value":4300}},"monthly_cost_usd":4300}
```
