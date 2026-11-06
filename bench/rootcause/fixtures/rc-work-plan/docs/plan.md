# Plan: event-driven invoice export

Goal: replace the nightly invoice CSV with an export that publishes each invoice to the queue when it is issued, and move the reports service to read from the queue.

Target: done in 3 weeks. Start Monday the 8th. Production deploy on Wednesday the 24th.

## Tasks

| # | Task | Owner | Duration | Depends on | Done when |
|---|------|-------|----------|------------|-----------|
| 1 | Write the event schema for an invoice | Eli | 2 days | none | schema agreed |
| 2 | Build the publisher in the invoice service | Dana | 5 days | 1 | |
| 3 | Make the exporter better | Dana | 4 days | none | it is better |
| 4 | Add retry and dead-letter handling with the standard retry settings | Gus | 3 days | 2 | works |
| 5 | Deploy publisher and consumer to staging | Eli | 2 days | 2, 4 | deployed |
| 6 | Load test with the Q3 volumes | Dana | 3 days | 2 | no failures |
| 7 | Build the ledger consumer | | 5 days | 1 | |
| 8 | Reconcile the queue output against the CSV for a full month | | 10 days | 7 | numbers match |
| 9 | Delete the nightly job | Gus | 1 day | 5 | job removed |
| 10 | Production deploy | Eli | 1 day | 9 | live |

## Notes

- Fran helps where needed.
- Everything not listed above is out of scope.
