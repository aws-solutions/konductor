# Order service architecture packet

This packet contains the design review material for the order service's proposed move from CRUD persistence to an event-sourced aggregate with read projections. It was assembled for the architecture council by the Order Platform team.

The proposal was written by Maya Chen, staff engineer, with review from the order API and fulfillment leads. The surrounding notes come from the service owners, the reliability group, and the reporting team. Numbers are representative of the production planning baseline at the time of writing. The file under review is `docs/adr/0007-event-sourced-orders.md`; the other files provide the contracts and operating context that the author used.

The packet is intentionally self-contained. It does not include application source code or credentials.
