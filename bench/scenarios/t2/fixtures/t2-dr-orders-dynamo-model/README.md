# Orders table design review packet

This packet is the working design for moving the Orders service from its relational store to one DynamoDB table. It contains the design proposal, service context, traffic and size estimates, operating constraints, and notes from the last production incident.

The packet was assembled by the Orders Platform team for review by the service owners and the data platform group. Priya Nair wrote the design, Marco Ruiz supplied the traffic and cost estimates, and Elena Park recorded the reporting requirements. Figures are from the February planning window and are intended to support the migration decision.

Start with `docs/design/orders-table-design.md`. The files under `context/` are the source material used by the proposal. The service is still running on the current relational implementation while the migration work proceeds in a development environment.
