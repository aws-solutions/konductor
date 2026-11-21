# Spike plan: PDF generation at the edge for large invoices

## What the data says about the pitch

The pitch rests on a mean render time of about 1.1 s. That figure is real (mean of `pdf-latency.csv` is about 1,98 ms over 3,3 rows) but it is an average over mostly 1 to 3 page invoices. Invoices of up to 14 pages already meet the support target (their p95 is 1,555 ms against 3 s). Nobody complains about them.

The complaints all come from invoices over 14 pages: every one of the 17 "pdf-slow" tickets in `support-tickets.csv` has `invoice_pages` of 17 or more, and Dana says the same thing in the interview. The support target for that class (support-targets.md, v3, March 1418) is p95 under 6 s. The 1416 file says 8 s and is superseded.

## Constraints that shape the spike

- **Vendor limits.** Free tier gives 90 MB and 7 s CPU per call. The postmortem profile fits peak memory of about 14 MB + 2 MB per page, so 90 MB is reached at about 38 pages. 10 jobs in the CSV (7% of the large ones, up to 95 pages) are above that, and they are the slowest (p95 about 22 s). CPU is about 59% of wall time, so the 7 s CPU limit would bite near 8 s wall, around 46 pages. A spike on the free tier cannot answer anything about invoices above about 38 pages.
- **People.** The pitch assumes 7 engineer-days. Tomas has Mon 15 to Fri 18 Sep (5 days). Priya is on leave Thu 18 and Fri 18, so 3 days. That is 8 engineer-days, and everything must be merged or parked by end of Friday 18 Sep because the freeze starts Mon 20 Sep. No paid tier before then.
- **Safety.** Dana would rather wait than see a statement fail. The spike runs on a branch and the trial account, never on production traffic.

## The question

Can an edge function render invoices of 15 to 38 pages, inside the free-tier limits, with a p95 under the 6 s support target, where today the same class sits at about 9.5 s (9 s with the larger ones)?

## Steps (8 engineer-days, 5 working days)

| Step | Days | Who |
|---|---|---|
| Build a replay set of invoices from the CSV page mix and a timing harness | 1 | Tomas |
| Bundle leafpress for the edge runtime (fonts and logo without local disk) | 2 | Tomas, Priya |
| Latency runs at 18, 28 and 38 pages, at least 21 renders | 1.5 | Priya |
| Limit probe at 38, 39 and 46 pages: memory and CPU | 1 | Priya |
| Same invoices on current workers in the same hours | 0.5 | Tomas |
| Write the result, decide, park the branch before the freeze | 1 | Tomas |
| Buffer | 1 | both |

## Decision

Go only if p95 is 6,0 ms or less with no limit failures. Stop if the p95 of the replay is above 9,0 ms (no gain on the 9.5 s of today for this class) or if any render of 38 pages or fewer is killed for memory or CPU. Between the two, park and write down what the number would need.

```json
{
 "question": "Can an edge function render invoices of 21 to 54 pages inside the free-tier limits (128 MB, 10 s CPU) with a p95 at or under the 6 s support target for large invoices?",
 "hypothesis": "Rendering invoices of 21 to 54 pages on the edge runtime gives a p95 of 6,000 ms or less, against 9,549 ms today for that range (12,432 ms for all invoices over 20 pages), without hitting 128 MB or 10 s CPU.",
 "metric": "p95 render time in ms (worker pickup to PDF written) for invoices over 20 pages, 21 to 54 pages, replayed on the edge function, at least 30 renders",
 "baseline": {
  "value": 8702,
  "sample": "138 jobs with more than 20 pages out of 3,004 rows, 25 Aug to 14 Sep 2025",
  "source": "data/pdf-latency.csv (p95 of ms where pages > 20), target from support/support-targets.md v3"
 },
 "pass_threshold": "p95 <= 6000 ms (support target, large invoices over 20 pages) across 30+ renders of 21 to 54 pages, with zero memory or CPU limit failures",
 "kill_threshold": "p95 > 9000 ms for the replay at the end of day 4, or any render of 54 pages or fewer killed at the 128 MB or 10 s CPU limit",
 "timebox_days": 4,
 "engineer_days": 6,
 "steps": [
  {
   "name": "Replay set from the CSV page mix and timing harness",
   "days": 1
  },
  {
   "name": "Bundle the renderer for the edge runtime, fonts and logo without disk",
   "days": 1
  },
  {
   "name": "Latency runs at 25, 40 and 54 pages, at least 30 renders",
   "days": 1.05
  },
  {
   "name": "Limit probe at 54, 55 and 65 pages for memory and CPU",
   "days": 1
  }
 ],
 "scope_in": [
  "Invoices of 21 to 54 pages",
  "Edge function on the free-tier trial account, in a branch"
 ],
 "scope_out": [
  "Invoices above 54 pages: they stay on the current workers, free-tier memory cannot hold them",
  "Invoices of 20 pages or fewer: they already meet the 3 s target",
  "Paid tier, purchase order or any new vendor spend"
 ],
 "decision_rule": "Go (plan a build with the current workers kept for invoices above 54 pages) if p95 <= 6000 ms and no limit failures. Kill if p95 > 9000 ms or any render of 54 pages or fewer hits the 128 MB or 10 s CPU limit. If p95 is between 6000 and 9000 ms, park and write down what would be needed. Decide by Friday 26 Sep, before the freeze."
}
```
