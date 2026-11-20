# Spike plan: PDF generation at the edge for large invoices

## What the data says about the pitch

The pitch rests on a mean render time of about 1.1 s. That figure is real (mean of `pdf-latency.csv` is about 1,140 ms over 3,004 rows) but it is an average over mostly 1 to 3 page invoices. Invoices of up to 20 pages already meet the support target (their p95 is 1,793 ms against 3 s). Nobody complains about them.

The complaints all come from invoices over 20 pages: every one of the 24 "pdf-slow" tickets in `support-tickets.csv` has `invoice_pages` of 24 or more, and Dana says the same thing in the interview. The support target for that class (support-targets.md, v3, March 2025) is p95 under 6 s. The 2023 file says 8 s and is superseded.

Today those 138 jobs (4.6% of the sample) have a p95 of about 12,400 ms (nearest rank 12,432 ms; median 5.7 s). So the spike measures that class, not the average.

## Constraints that shape the spike

- **Vendor limits.** Free tier gives 128 MB and 10 s CPU per call. The postmortem profile fits peak memory of about 20 MB + 2 MB per page, so 128 MB is reached at about 54 pages. 14 jobs in the CSV (10% of the large ones, up to 135 pages) are above that, and they are the slowest (p95 about 30.9 s). CPU is about 85% of wall time, so the 10 s CPU limit would bite near 11.8 s wall, around 65 pages. A spike on the free tier cannot answer anything about invoices above about 54 pages.
- **People.** The pitch assumes 10 engineer-days. Tomas has Mon 22 to Fri 26 Sep (5 days). Priya is on leave Thu 25 and Fri 26, so 3 days. That is 8 engineer-days, and everything must be merged or parked by end of Friday 26 Sep because the freeze starts Mon 29 Sep. No paid tier before then.
- **Safety.** Dana would rather wait than see a statement fail. The spike runs on a branch and the trial account, never on production traffic.

## The question

Can an edge function render invoices of 21 to 54 pages, inside the free-tier limits, with a p95 under the 6 s support target, where today the same class sits at about 9.5 s (12.4 s with the larger ones)?

The 6 s target is the pass line, not "real-time". Edge may not help at all: layout is CPU-bound, and moving it closer to the customer removes little. That is what the spike finds out.

## Steps (6 engineer-days, 5 working days)

The team has 8 engineer-days free. The plan books 6 of them, one of which is a buffer, and leaves the other 2 for the normal pre-freeze work, so nobody is pushed into the freeze.

| Step | Days | Who |
|---|---|---|
| Build a replay set of invoices from the CSV page mix and a timing harness | 1 | Tomas |
| Bundle leafpress for the edge runtime (fonts and logo without local disk) | 1.5 | Tomas |
| Latency runs at 25, 40 and 54 pages, at least 30 renders | 1 | Priya |
| Limit probe at 54, 55 and 65 pages: memory and CPU | 0.5 | Priya |
| Same invoices on current workers in the same hours | 0.5 | Priya |
| Write the result, decide, park the branch before the freeze | 0.5 | Tomas |
| Buffer | 1 | both |

## Decision

Go only if p95 is 6,000 ms or less with no limit failures. Stop if the p95 of the replay is above 9,000 ms (no gain on the 9.5 s of today for this class) or if any render of 54 pages or fewer is killed for memory or CPU. Between the two, park and write down what the number would need.

```json
{
  "question": "Can an edge function render invoices of 21 to 54 pages inside the free-tier limits (128 MB, 10 s CPU) with a p95 at or under the 6 s support target for large invoices?",
  "hypothesis": "Rendering invoices of 21 to 54 pages on the edge runtime gives a p95 of 6,000 ms or less, against 9,549 ms today for that range (12,432 ms for all invoices over 20 pages), without hitting 128 MB or 10 s CPU.",
  "metric": "p95 render time in ms (worker pickup to PDF written) for invoices over 20 pages, 21 to 54 pages, replayed on the edge function, at least 30 renders",
  "baseline": {
    "value": 12432,
    "sample": "138 jobs with more than 20 pages out of 3,004 rows, 25 Aug to 14 Sep 2025",
    "source": "data/pdf-latency.csv (p95 of ms where pages > 20), target from support/support-targets.md v3"
  },
  "pass_threshold": "p95 <= 6000 ms (support target, large invoices over 20 pages) across 30+ renders of 21 to 54 pages, with zero memory or CPU limit failures",
  "kill_threshold": "p95 > 9000 ms for the replay at the end of day 4, or any render of 54 pages or fewer killed at the 128 MB or 10 s CPU limit",
  "timebox_days": 5,
  "engineer_days": 6,
  "steps": [
    { "name": "Replay set from the CSV page mix and timing harness", "days": 1 },
    { "name": "Bundle the renderer for the edge runtime, fonts and logo without disk", "days": 1.5 },
    { "name": "Latency runs at 25, 40 and 54 pages, at least 30 renders", "days": 1 },
    { "name": "Limit probe at 54, 55 and 65 pages for memory and CPU", "days": 0.5 },
    { "name": "Same invoices on current workers, same hours", "days": 0.5 },
    { "name": "Write the result and decision, park the branch before the freeze", "days": 0.5 },
    { "name": "Buffer for bundling problems and reruns", "days": 1 }
  ],
  "scope_in": [
    "Invoices of 21 to 54 pages",
    "Edge function on the free-tier trial account, in a branch",
    "p95 render time and peak memory against the 6 s target and the 128 MB limit",
    "Probe of the limit behaviour at 54, 55 and 65 pages"
  ],
  "scope_out": [
    "Invoices above 54 pages: they stay on the current workers, free-tier memory cannot hold them",
    "Invoices of 20 pages or fewer: they already meet the 3 s target",
    "Paid tier, purchase order or any new vendor spend",
    "Queue wiring, storage, rollout or any production traffic",
    "Cost comparison"
  ],
  "decision_rule": "Go (plan a build with the current workers kept for invoices above 54 pages) if p95 <= 6000 ms and no limit failures. Kill if p95 > 9000 ms or any render of 54 pages or fewer hits the 128 MB or 10 s CPU limit. If p95 is between 6000 and 9000 ms, park and write down what would be needed. Decide by Friday 26 Sep, before the freeze."
}
```
