# Design review

The proposal has a sensible high-level shape: build a separate generation, keep the stable alias for clients, and cap copy work. I would not approve the production run yet. The writer handoff and cutover leave correctness and recovery gaps, while the capacity math does not represent the overlap that the procedure itself creates. The acceptance criteria also cannot distinguish a usable catalog from an endpoint that merely returns successful HTTP responses.

The most urgent issue is the writer sequence. The old index changes while the copy is in progress, but the new writer starts only after the copy reports completion. A document copied before its latest update remains stale in the new index. Use dual-writing before the copy, or record and replay the complete event range after the copy with a defined catch-up point and delete handling.

The cutover has no tested recovery route. Keeping the old generation for only 15 minutes and then deleting it is not a rollback plan, especially because the mapping incident shows that a green basic check can still precede bad results. Define an alias reversal, retain the old generation for a stated observation period, and document who can execute and validate the rollback.

The storage calculation uses the replacement footprint plus 60 GiB, but the old generation is still present during the copy. The sizing sheet also requires 15 percent free, which is 112.5 GiB per node on these volumes. Recalculate peak placement including both generations, replicas, merges, and recovery space, then add capacity or change the run plan before scheduling it.

The copy estimate is based on 18,000 writes per hour even though the traffic data reaches 61,200. Recalculate the window and any event catch-up allowance from the peak or a stated percentile, and explain how the operation is scheduled around that load.

The `completed` task state and three smoke queries do not establish that the replacement has all expected documents. Add a completeness gate such as source and destination counts by shard or a suitable reconciliation/checksum, and make failed bulk requests and version conflicts visible to that gate.

Finally, the success rule needs numbers. Use the service targets for availability, p95 and p99 latency, empty-result rate, writer lag, and bulk failures, and run the fixed control-query set before and after cutover. “HTTP 200” can still mean an empty or materially degraded catalog.

```json
[
  {
    "location": "3.2",
    "severity": "critical",
    "issue": "Dual writing starts only after the bulk copy, so updates that arrive while documents are being copied can be missing from the replacement index at cutover.",
    "fix": "dual-write before copy or replay events through a defined catch-up point"
  },
  {
    "location": "3.4",
    "severity": "high",
    "issue": "The old generation is deleted shortly after the alias swap and the design provides no alias reversal or other rollback path if the new generation fails.",
    "fix": "retain old index and document a tested rollback path with alias reversal"
  },
  {
    "location": "4.1",
    "severity": "high",
    "issue": "The storage math omits the old generation during the overlap and uses a 60 GiB buffer below the sizing sheet's 15 percent free requirement, so nodes can run out of disk.",
    "fix": "include old index, preserve 15 percent free, and expand storage if the peak does not fit"
  },
  {
    "location": "3.3",
    "severity": "medium",
    "issue": "The copy window uses 18,000 writes per hour even though the traffic data records a 61,200-write peak, so the duration and overlap allowance are understated.",
    "fix": "recalculate from the peak write rate and include the event catch-up time"
  },
  {
    "location": "4.3",
    "severity": "high",
    "issue": "A completed task and a few successful queries do not prove that the replacement contains the complete catalog before promotion.",
    "fix": "add a document count or checksum completeness gate before cutover"
  },
  {
    "location": "5.1",
    "severity": "medium",
    "issue": "The success definition has no measurable thresholds and treats HTTP 200 with some results as sufficient despite the service targets and control-query data.",
    "fix": "use measurable thresholds for the control query, latency, empty results, and writer lag"
  }
]
```