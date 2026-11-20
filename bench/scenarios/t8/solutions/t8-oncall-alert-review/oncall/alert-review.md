# February alert review

## Decision

I reviewed the deployed rules against the February firing export, incident register, current metric catalogue, deploy history, logs, and the linked runbooks. The main page load comes from alerts that fire during normal operation or that describe a possible cause rather than customer impact. The February 18 outage was a useful control: it had database-pool waiters, 503s, and a full current pool, while API process CPU was 0.41. The web-api release began at 2025-02-18T14:03:00Z and was rolled back after the incident.

The recommendations below retain the rules that caught real incidents or give useful early warning. They change noisy pages to tickets where an engineer can follow up during normal hours, remove one duplicate and one unhelpful symptom, and repair the stale database metric. The counts use the 30-day export. Log references use one-based line numbers.

## Changes

- **ApiLatencyP95** fired 29 times, mostly around the recurring evening peak. Its 850 ms threshold is below the normal hour-of-day peak, so it pages on expected behavior. Raise the threshold to `http_request_duration_p95_ms > 1200` for 10m and route it to `edge-queue` as a ticket. Evidence: `logs/api-gateway.log:82` shows ordinary evening traffic and the firing times are in `history/alert-firings.csv`.
- **ApiCpuSaturation** fired 15 times without a linked incident. CPU is a possible cause signal, not proof of a customer outage; during the real outage the log showed CPU at 0.41 while requests failed. Change it to `process_cpu_utilization > 0.90` for 15m, route it to `platform-queue`, and make it a ticket. Evidence: `logs/api-gateway.log:1804`.
- **DbConnectionPoolExhaustion** has no valid firing in the review window because its expression uses the absent `db_pool_used_ratio` name. The current catalogue and outage logs use `db_pool_in_use_ratio`; the pool reached 1.00 and callers waited. Change it to `db_pool_in_use_ratio > 0.90` for 3m, keep it as a page, and route it to `data-primary`. Evidence: `logs/api-gateway.log:1800-1803`.
- **Api5xxBurst** is an exact duplicate of `ApiHigh5xxRate`, with the same expression and the same February 18 incident. Remove it rather than sending two pages for one signal. Evidence: `logs/api-gateway.log:1801`.
- **ApiNoTraffic** fired 44 times, was acknowledged repeatedly, and never linked to an incident. It has no runbook and is a weak symptom for a service with quiet routes and health checks. Remove the page. Evidence: `logs/api-gateway.log:3` shows the independent health check and the corresponding entries are in `history/alert-firings.csv`.
- **RequestTimeoutRate** fired 10 times with no linked incident. It is useful follow-up information but does not need immediate paging at the current threshold. Keep `request_timeout_rate > 0.015` for 5m, route it to `edge-queue`, and change the severity to a ticket.
- **QueueDepthSpike** fired five times with a zero-minute duration and short, quickly acknowledged episodes. Require `worker_queue_depth > 500` for 10m and route it to `jobs-primary` as a ticket. Queue age remains the page for customer-relevant backlog.

## Keep

Keep `ApiHigh5xxRate`, `HealthCheckDown`, `QueueAgeHigh`, `WorkerErrorRate`, `CacheHitRateLow`, `LoginFailureSpike`, `PaymentProviderLatency`, `SearchIndexLag`, `DiskSpaceLow`, `DeploymentFailure`, and `TLSCertificateExpiry` as they are. The API error and health rules both fired during the February 18 outage but measure different symptoms. Queue age, worker errors, and provider latency correspond to incidents or actionable customer impact. The remaining ticket and release rules provide useful lead time without adding an unnecessary primary page.

## Follow-up

After applying the changes, compare the next seven days of firing counts with the same hour-of-day slices. Confirm that the repaired database rule evaluates against the current catalogue before enabling it. A future review should also add a runbook for any new symptom alert instead of routing an undocumented symptom directly to the primary pager.

```json
{
  "alerts": [
    {
      "name": "ApiLatencyP95",
      "problem": "The 850 ms threshold is below the normal evening peak, so this page fires on expected daily behavior. It fired 29 times in the 30-day export; an ordinary evening request is recorded at logs/api-gateway.log:82.",
      "change": "Use http_request_duration_p95_ms > 1200 for 10m, route to edge-queue, and make the alert a ticket.",
      "severity": "ticket"
    },
    {
      "name": "ApiCpuSaturation",
      "problem": "CPU is a cause signal without matching user impact. It fired 15 times without an incident, and the outage at 2025-02-18T14:16:41Z shows CPU at 0.41 while requests failed (logs/api-gateway.log:1804).", 
      "change": "Use process_cpu_utilization > 0.90 for 15m, route to platform-queue, and make the alert a ticket.",
      "severity": "ticket"
    },
    {
      "name": "DbConnectionPoolExhaustion",
      "problem": "The rule uses the missing db_pool_used_ratio metric name. The current pool metric is db_pool_in_use_ratio, and at 2025-02-18T14:13:19Z the outage showed a full pool and connection waiters (logs/api-gateway.log:1800-1803).",
      "change": "Use db_pool_in_use_ratio > 0.90 for 3m, route to data-primary, and keep this as a page.",
      "severity": "page"
    },
    {
      "name": "Api5xxBurst",
      "problem": "This is a duplicate of ApiHigh5xxRate with the same 5xx expression and the same February 18 incident.",
      "change": "Remove the duplicate rule and its page.",
      "severity": "remove"
    },
    {
      "name": "ApiNoTraffic",
      "problem": "This symptom page fired 44 times, was acknowledged repeatedly, had no linked incident, and has no runbook; the independent health check is visible at logs/api-gateway.log:3.",
      "change": "Remove the no-traffic page rather than routing this undocumented symptom to the primary pager.",
      "severity": "remove"
    },
    {
      "name": "RequestTimeoutRate",
      "problem": "The timeout signal fired 10 times without a linked incident and is useful follow-up work but is non-urgent for immediate paging.",
      "change": "Use request_timeout_rate > 0.015 for 5m, route to edge-queue, and change the alert to a ticket.",
      "severity": "ticket"
    },
    {
      "name": "QueueDepthSpike",
      "problem": "The queue rule has no duration and flaps during brief episodes. It fired five times with short acknowledgements while queue age is the customer-impact signal.",
      "change": "Use worker_queue_depth > 500 for 10m, route to jobs-primary, and make the alert a ticket.",
      "severity": "ticket"
    }
  ],
  "keep": [
    "ApiHigh5xxRate",
    "HealthCheckDown",
    "QueueAgeHigh",
    "WorkerErrorRate",
    "CacheHitRateLow",
    "LoginFailureSpike",
    "PaymentProviderLatency",
    "SearchIndexLag",
    "DiskSpaceLow",
    "DeploymentFailure",
    "TLSCertificateExpiry"
  ]
}
```