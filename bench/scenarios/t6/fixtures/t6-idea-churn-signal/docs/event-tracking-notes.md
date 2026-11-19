# Event tracking notes

On July 1, Priya found that the cancellation-start event queue rejected a batch from June 10 through June 16. The backfill was not possible because the client did not retain the event payload. Billing events are not affected.

The cancellation flow completion event is available in the billing ledger, but the dashboard's cancellation-start chart uses the broken product stream. Treat the low raw count for that week as a measurement gap, not as evidence that fewer members considered cancelling.

No payment processor events were lost in this incident.
