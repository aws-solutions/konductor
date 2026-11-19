# Product and service requirements

The first release keeps the ticket record in one logical relational model. A request always has the tenant context available before it reaches the data layer. A support agent can use the same human-readable ticket key as an agent at another customer without receiving the other customer's record.

The service-level review uses these acceptance targets for the shared ticket API:

| Measure | Acceptance target | Scope |
| --- | ---: | --- |
| Ticket lookup latency | p95 no more than 120 ms | tenant-scoped key lookup |
| Sustained write capacity | at least 2,500 writes/second | ticket and status updates |
| Retained logical data | no more than 620 GB | current production retention |
| Infrastructure spend | no more than 600 USD/month | storage, database capacity, and request charges |

A small prototype from the EU sandbox used an 80 ms lookup target. That target is **superseded by the 120 ms production target above** and must not be used for this review.

The database design should make the tenant predicate part of the access path rather than relying on application code to filter a broad result. It should also document why its indexes support the request shapes described in the traffic notes.
