# Fact-check of draft/memo.md

Checked against the notes in `sources/`. No files were changed.

## Findings

### 1. Queue A throughput is misquoted by ten times

Severity: critical

The memo says Queue A tops out at 500 messages a second per partition. `queue-a.md` and `benchmark-notes.md` both say 5,000. At 5,000 one partition covers the 2,000 peak, so the memo's main argument against Queue A falls away.
Fix: correct the figure and rework the recommendation.

### 2. The cost claim is uncited and wrong

Severity: important

"Queue B is also cheaper at our volume" has no source. `benchmark-notes.md` puts Queue A at about 80 a month and Queue B at a fixed 1,200 at 200 million messages a month, so Queue B is more expensive.
Fix: cite the numbers and reverse the claim.

### 3. The latency figure is stale

Severity: important

The 60 ms p99 for Queue B comes from `queue-b.md` (2023), which says it is superseded. The 2025 benchmark gives 25 ms.
Fix: use the benchmark figure and say which note it comes from.

### 4. Inconsistent names for the options

Severity: suggestion

The memo calls them Option A, Queue A, the managed queue and the self-run broker. Pick one label for each.

### 5. One long paragraph and no dates on sources

Severity: suggestion

The "Why" section is a single dense paragraph, and the cited notes carry no dates. Split it into short sections and add the date of each source.
