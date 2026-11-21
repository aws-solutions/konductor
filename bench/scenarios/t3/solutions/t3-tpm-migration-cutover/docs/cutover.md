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

## Timing, go condition and rollback

The seed must finish before 02:00 Sunday. During customer traffic the application already writes 90 MB/s under the 150 MB/s business-hours cap, so only about 60 MB/s is spare: 1.8 TB takes about 8.3 hours at that rate. Off hours it takes about 67 minutes at 450 MB/s. Start the seed by Saturday 17:00 so it finishes with room to spare.

Go only when replication lag is under 120 seconds and the target confirms the recorded source position. If the write pause reaches its 8-minute budget before the target confirms, stop: resume writes on the source and try again in the next window.

The rollback checkpoint is the source's last confirmed consistent position, recorded at the pause. Once the writer endpoint switches, writes the target accepts are lost on rollback unless they are replicated back to the source, so the switch is the point of no return.

## Margins and cost basis

The replication path has no throughput margin: 150 MB/s equals the 150 MB/s minimum exactly, so any throttle below the published allowance breaks the plan. The choice would change if the monthly ceiling rose to at least 6,700 USD (dual_write would fit) or if the data set were small enough for a big-bang copy inside 20 minutes (under about 0.54 TB at 450 MB/s).

Dual-write costs 2,400 + 1,200 + 300 + 2,800 = 6,700 USD per month against the 5,000 USD ceiling, and it has no shared commit across the two ledgers. The monthly figures hold recurring items only: one-time implementation labor is excluded, as cost-notes.md says. The 400 USD migration support line is counted because it is billed monthly for the migration period, and it stops afterwards.

```decision
{"chosen":"continuous_replication","options":["big_bang_copy","continuous_replication","dual_write"],"limits":{"downtime_min":{"limit":20,"value":8},"rpo_min":{"limit":5,"value":2},"latency_ms":{"limit":30,"value":12},"throughput_mb_s":{"limit":150,"value":150},"monthly_cost_usd":{"limit":5000,"value":4300}},"monthly_cost_usd":4300}
```
