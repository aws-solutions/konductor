# Postmortem: catalogue page errors, 2025-03-18

## Summary

Three times in one afternoon, about 38,000 cache entries expired at the same instant and their refills hit the
database together. Each burst lasted four minutes and failed 3,960 product page requests in total over 12 minutes.

## What happened

At 14:42 a cache policy reload set every key to a 1,800-second TTL and warmed all 38,400 keys in one pass
(`deploy/deploy-history.jsonl:4`, `config/config-review.diff:7-8`). Every key then shared one expiry time. At 15:12,
exactly 30 minutes later, 38,194 keys expired at once and sent 486 refills (`logs/cache.log:583`). The primary hit its
240-connection ceiling with 486 waiters (`logs/db.log:585`), the hit ratio fell to 0.18 and page errors reached 420 a
minute (`metrics/catalog-minute.csv:194`). The same thing happened at 15:42 and 16:12.

This was not the reporting job. The `analytics_rollup` query ran at 12:30, finished, and did not repeat.

## Why we were slow

Each burst lasted four minutes. The page-error alert needs two minutes over threshold and the hit-ratio alert three,
so pages arrived halfway through each burst, and each burst cleared by itself before anyone acted. The config review
passed `jitter_seconds: 0`.

## Response

At 16:19 Maya Chen applied a policy with 120 seconds of jitter and paused the full warmup; at 16:22 the API refill
backoff went live. The connection ceiling was left at 240, as the runbook says. The proof the fix worked is 16:42: the
next 30-minute boundary passed with a normal hit ratio. At 16:27 waiters were zero.

The committed `config/cache-policy.yaml` still says `jitter_seconds: 0`, and the 16:19 deploy says "staged". Until the
live policy is committed, the next reload brings the bug back.

```json
{
  "rootCause": {
    "summary": "A policy reload gave all 38,400 warmed cache keys the same 1,800 s TTL, so they expired together every 30 minutes and their refills flooded the database.",
    "evidence": [
      "deploy/deploy-history.jsonl:4",
      "config/config-review.diff:7",
      "logs/cache.log:583",
      "logs/db.log:585",
      "metrics/catalog-minute.csv:194"
    ]
  },
  "timeline": [
    {"time": "2025-03-18T14:42:00Z", "event": "Policy reload: TTL 1800 s for every key, warmup of 38400 keys."},
    {"time": "2025-03-18T15:12:00Z", "event": "Keys expire at once; cache misses and page errors, database at 240 connections."},
    {"time": "2025-03-18T15:42:00Z", "event": "Second wave: misses and database connections saturated again."},
    {"time": "2025-03-18T16:12:00Z", "event": "Third wave, 30 minutes after the second."},
    {"time": "2025-03-18T16:19:00Z", "event": "Policy with 120 s jitter applied; full warmup paused."},
    {"time": "2025-03-18T16:27:00Z", "event": "Waiters at zero; page path healthy."},
    {"time": "2025-03-18T16:42:00Z", "event": "Next expected wave does not come."}
  ],
  "impact": {
    "failedPageRequests": 3960,
    "peakDbCpuPercent": 99.2,
    "peakDbConnections": 240,
    "affectedMinutes": 12
  },
  "actionItems": [
    {"text": "Coalesce cache refills per key (single-flight) and serve the stale entry while one refresh runs.", "owner": "Maya Chen"},
    {"text": "Page on cache hit ratio below 0.7 together with database waiters, with a one-minute window.", "owner": "Ravi Mehta"},
    {"text": "Lint cache policy changes so a zero jitter or a single-pass warmup fails review, and stage reloads on one node first.", "owner": "Nora Ives"},
    {"text": "Commit the live cache policy to config/cache-policy.yaml.", "owner": "Maya Chen"}
  ]
}
```
