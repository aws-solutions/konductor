# Payments Ledger

## Problem

The ledger runs on a single MySQL 5.7 instance that hits 92% CPU at 1,800 writes/s during sales. Sales peaks are
projected at 6,000 writes/s next year. Failover takes 4-6 minutes and we lost 2 minutes of writes during the March
failover.

## Solution Overview

Move ledger entries to a new store with per-account partitioning and conditional writes for idempotency. Entries are
append-only; balances are derived.

## Trade-offs

| Option          | Cost | Latency | Complexity | Scalability | Operability | Total |
| --------------- | ---- | ------- | ---------- | ----------- | ----------- | ----- |
| DynamoDB        | 4    | 5       | 3          | 5           | 4           | 21    |
| Aurora Postgres | 3    | 4       | 4          | 3           | 4           | 18    |

Notes: DynamoDB on-demand handled 8,000 writes/s at p99 7 ms in our load test (report LT-2025-11). Aurora
db.r6g.2xlarge peaked at 4,200 writes/s at p99 18 ms in the same test. 3 of 7 engineers have run DynamoDB in production;
5 of 7 know Postgres. Ledger reports today use SQL joins that would need to move to an export + Athena path.

## Implementation Plan

| Phase | Work                                      |
| ----- | ----------------------------------------- |
| 1     | Table + write path behind a feature flag  |
| 2     | Dual-write and reconcile for 2 weeks      |
| 3     | Cut reads over, retire MySQL              |
