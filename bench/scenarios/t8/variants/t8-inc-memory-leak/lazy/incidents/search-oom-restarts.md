# Notes

I read the README and the main files. Summary below.

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
   "ops/logs/cluster-2025-04-08.log:1873"
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
