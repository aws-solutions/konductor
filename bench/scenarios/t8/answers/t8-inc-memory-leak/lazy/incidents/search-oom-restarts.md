# Search API memory and restart incident

**Incident window:** 2025-04-09T06:20:00Z to 2025-04-10T13:25:00Z  
**Service:** Atlas search API, eight containers  
**Severity:** SEV-2

## Summary

The restart bursts came from release 3.8.0 enabling a response cache keyed by the full query string without a maximum entry count. Distinct queries accumulated in each 3.8.0 process, driving its working set toward the 1434 MiB container limit. The node agent recorded SIGKILL/OOM events, and the gateway then emitted short 352 retry bursts.

The first warning appeared at 2025-04-08T15:35:00Z, 67 minutes after the release, with `search-03` at 584 MiB and 114 cache entries. The release diff shows the full-query key and a null `max_entries`. The old-version holdout, `search-08`, remained on 3.7.4 at roughly 525 MiB with zero cache entries at the first kill window, while the 3.8.0 cohort climbed above 2 GiB. The April 9 campaign raised request and distinct-query volume, so it shortened the time between kills, but it did not explain the version-specific memory behavior.

## Impact

- 29 OOM kills across seven 3.8.0 containers. The 3.7.4 holdout had no OOM restart.
- 5,32 failed requests counted by summing `error_count` for all container CSV rows from the first OOM through stable recovery.
- 1,606 minutes from the first OOM kill to stable recovery.

## Timeline

- **2025-04-08T14:00:00Z:** Release 3.8.0 reached the search API cohort.
- **2025-04-08T15:35:00Z:** First memory-growth warning recorded for `search-03`; cache entries and distinct queries were already rising.
- **2025-04-09T06:20:00Z:** `search-01` recorded the first kernel OOM event and SIGKILL.
- **2025-04-09T09:00:00Z:** A marketing campaign increased traffic and distinct-query rate. The increase correlated with shorter growth cycles, but the 3.7.4 holdout stayed flat.
- **2025-04-10T12:40:00Z:** The rollout restored 3.7.4 and disabled the cache configuration.
- **2025-04-10T13:25:00Z:** Memory headroom, restart rate, and error rate returned to stable levels.

## Evidence

The release record, configuration diff, sampled metrics, and lifecycle logs form one chain. The relevant lines are cited below so another engineer can reproduce the conclusion.

## Follow-up actions

- Disable the full-query cache by default. If it returns, require a bounded `max_entries` value and an explicit memory budget. **Owner:** Mira Chen
- Add a promotion gate that tracks `memory_mb` slope, `cache_entries`, and `distinct_queries` by release version under campaign-like traffic. **Owner:** Jon Bell
- Page on sustained memory growth or unbounded cache-entry growth, and compare the new cohort with the old-version canary before expanding traffic. **Owner:** Ravi Iyer

```json
{
 "rootCause": {
  "summary": "Release 3.8.0 enabled a full-query response cache with no entry bound; distinct queries accumulated until the 2048 MiB container limit caused OOM kills.",
  "evidence": [
   "ops/deploy-history.csv:5",
   "ops/config/release-diff.yaml:8",
   "ops/config/release-diff.yaml:11",
   "ops/config/release-diff.yaml:13",
   "ops/change-record.yaml:6",
   "ops/logs/cluster-2025-04-08.log:1873",
   "ops/logs/cluster-2025-04-09.log:765",
   "ops/metrics/container-search-08.csv:654",
   "ops/metrics/container-search-01.csv:654",
   "ops/logs/cluster-2025-04-10.log:1582",
   "ops/logs/cluster-2025-04-10.log:1677"
  ]
 },
 "timeline": [
  {
   "time": "2025-04-08T14:00:00Z",
   "event": "Release 3.8.0 deployed to the search API cohort."
  },
  {
   "time": "2025-04-08T15:35:00Z",
   "event": "First memory-growth warning showed cache entries and distinct queries increasing in search-03."
  },
  {
   "time": "2025-04-09T06:20:00Z",
   "event": "First kernel OOM event killed search-01."
  }
 ],
 "impact": {
  "degradedMinutes": 1306,
  "oomKills": 29,
  "failedRequests": 3532
 },
 "actionItems": [
  {
   "text": "Disable the full-query cache by default and require a bounded max_entries value plus a memory budget before re-enabling it.",
   "owner": "Mira Chen"
  },
  {
   "text": "Add a release gate using memory_mb slope, cache_entries, and distinct_queries under representative high-cardinality traffic.",
   "owner": "Jon Bell"
  }
 ]
}
```
