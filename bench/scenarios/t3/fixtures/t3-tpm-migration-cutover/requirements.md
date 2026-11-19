# Production migration requirements

The payments ledger database is moving from the primary cluster to a new cluster in the same region. The current inventory is 1.8 TB of live data. The application can tolerate a short write pause, but the maintenance calendar reserves only 20 minutes for the user-visible cutover.

## Acceptance requirements

| Requirement | Acceptance target | Evidence source |
| --- | ---: | --- |
| User-visible downtime | no more than 20 minutes | maintenance reservation |
| Recovery point | no more than 5 minutes of acknowledged writes | replication status at handoff |
| Added request latency | no more than 30 ms at p95 | traffic profile |
| Business-hours replication rate | at least the published 150 MB/s allowance | throttle sheet |
| Recurring migration spend | no more than 5,000 USD per month | price sheet |

The 20-minute downtime allowance is also the service recovery time objective (RTO) for this change. The recovery point target applies to acknowledged writes, not to an uncommitted client request. The cutover plan must leave an operator with a measurable handoff condition rather than relying on an informal estimate.

A previous inventory review mentioned 2.4 TB for a staging copy. That environment was retired; the 1.8 TB production inventory above is the current scope.
