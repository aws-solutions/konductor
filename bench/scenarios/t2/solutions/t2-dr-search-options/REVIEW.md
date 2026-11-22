## Verdict

Do not approve the recommendation yet. Northstar may be a sensible direction, but the decision is not supported by a comparable scorecard, a complete cost model, or evidence at the catalogue's planned size. The migration plan also omits the work that makes a new index safe to serve. Rework the evaluation and show a staged, measurable path through the launch gates before committing to the vendor.

The most important risk is that the document treats a small vendor benchmark as evidence for a 40-million-product system. The language trial is also narrower than the storefront requirement. Before approval, the team should define the analyzers and acceptance cases for every locale, test the target index at projected scale and campaign traffic, and show how a complete index is built and switched without serving missing documents.

The design should also make several operational behaviors explicit. It needs a degraded-mode policy for vendor timeouts and quota exhaustion, including the request budget and what happens when falling back to PostgreSQL. It should test duplicate and out-of-order catalogue events, consumer replay, and stale-document detection against the indexing contract. Finally, the team should document vendor exit and snapshot restore, index mapping compatibility during rollback, credentials and access boundaries, and the failure scope of a regional or control-plane outage.

## Findings

### 3.2

The weighting contradicts the priority order stated in section 2.3. Relevance and cost are declared first and second, but receive 20% and 15%, while latency and operating simplicity receive 35% and 30%. Reweight criteria to reflect the stated priority order, or obtain an explicit decision on the changed priorities and show how each option's result changes.

### 3.3

The self-run total counts infrastructure but assigns zero engineering FTE, while the PostgreSQL and managed rows include staff time. That is not a like-for-like cost comparison, and the omission matters more for a five-person team that would own upgrades, recovery, capacity, and on-call work. Include self-run staff time using the same fully loaded rate and model the resulting annual total against the operating envelope.

### 3.4

The selected option's 115 ms p95 comes from a vendor page using 2 million documents, 40 concurrent requests, 24 results, and a narrow query mix. The packet projects 40 million products, 108 million localized title rows, and 1,300 peak QPS in two years. Run a benchmark on a representative dataset and traffic mix, including the 40 million-product planning point, and record warm-cache, cold-start, quota, and saturation behavior before assigning a latency score.

### 3.5

The evaluation does not cover the required multi-language behavior. It tests only English and French tokenization, while the context requires locale-specific stemming and analyzer handling for English, French, German, Finnish, and the planned Swedish storefront. Define language analyzers and stemming cases with the language team, retain display titles separately, and make those cases part of the option comparison and launch gate.

### 3.6

Calling migration low effort is unsupported. The target starts empty, and the catalogue contract requires a snapshot load followed by event replay to a known version before a read switch. Add a reindex and backfill plan with duration, capacity, checkpoint and replay handling, document-count and freshness checks, and the conditions for an atomic cutover and rollback.

### 3.7

The database comparison measures an unanchored substring scan over two fields. The storefront path uses a locale- and department-filtered title prefix query and does not search description text. Re-run the comparison against the actual workload, including the prefix query at current and campaign rates, then report the query plan, replica capacity, and p95/p99 results before rejecting the database option on latency.

```json
[
  {
    "location": "3.2",
    "severity": "high",
    "issue": "The scorecard weights latency and operating simplicity above relevance and cost even though the document declares relevance and cost as the first priorities, so the recommendation depends on a contradictory decision model.",
    "fix": "Reweight criteria to match the stated priority order, or explicitly approve and explain the changed weights."
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "The self-run option omits engineering staff time while the other options include it, understating the cost of ownership for the team that would operate the cluster.",
    "fix": "Include self-run staff time using the same fully loaded engineering rate and recalculate the annual total."
  },
  {
    "location": "3.4",
    "severity": "critical",
    "issue": "The managed-service latency evidence uses a 2-million-document vendor benchmark, not the projected 40-million-product catalogue and its future traffic, so the selected option has no scale-valid target evidence.",
    "fix": "Run a benchmark on a representative dataset and traffic mix at the 40 million planning point before assigning the latency score."
  },
  {
    "location": "3.5",
    "severity": "high",
    "issue": "The relevance trial omits the required multi-language stemming and analyzer behavior across the storefront locales, which can make search fail the language acceptance requirements.",
    "fix": "Add multi-language stemming cases and locale-specific analyzers to the comparison and launch gate."
  },
  {
    "location": "3.6",
    "severity": "medium",
    "issue": "The migration estimate is low but gives no executable plan to reindex or backfill the full catalogue and catch up with events before cutover.",
    "fix": "Add a reindex and backfill plan with checkpoints, replay, validation, and cutover criteria."
  },
  {
    "location": "3.7",
    "severity": "medium",
    "issue": "The rejected database option is benchmarked with an unanchored substring scan that the storefront does not use, so its latency score is not evidence about the actual prefix workload.",
    "fix": "Benchmark the actual workload using the locale-filtered prefix query at current and campaign rates."
  }
]
```