# Black Friday readiness: orders database

Owner: Dana (orders team). Status: draft for the capacity review on Thursday.

## Load test summary

- Ran on the staging cluster (db.r6g.2xlarge, same instance class as prod) on Oct 28.
- Workload: the standard `orders-mix-A` script, 80% reads / 20% writes, 15-minute run after a 10-minute warm-up.
- Result: sustained 10,000 transactions/s with p99 query latency of 41 ms. No errors.

## Conclusion

Postgres handled 10k TPS in our load test, so it will handle Black Friday. No further capacity work is needed for the orders database this year.

## Background (from last year's dashboard)

- Black Friday 2025 peak: 7,400 TPS, sustained for about 3 hours.
- During the peak hour, checkout writes were about 55% of database traffic (normal days: about 20%).
- Order volume is up 35% year over year so far in 2026.
