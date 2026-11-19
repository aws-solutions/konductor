# Operations and cost notes

Finance will treat the retry mechanism as part of the delivery service. The monthly operating envelope for this component is **$300 USD**. The estimate should use the price sheet and the production traffic profile, not a one-time migration charge.

The existing relational cluster is already monitored by the service team. A new external broker would require an on-call runbook, access policy, and a restore drill. The team can accept a small amount of polling overhead when it buys predictable recovery behavior.

The $300 figure is a recurring monthly ceiling. It does not include the base application container, which is already funded elsewhere.
