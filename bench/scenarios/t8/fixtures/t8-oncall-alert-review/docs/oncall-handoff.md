# February on-call handoff

The rotation covered the web API, background jobs, identity, search, and billing queues. Keep an eye on the handoff channel for provider maintenance windows. The primary rotation was Mira, Jon, Priya, Devin, and Rhea; the secondary was the platform team.

The API has a regular evening traffic peak. Health checks and request errors are the fastest signals when a user-facing path is unavailable. Background work can remain busy after the customer-facing path recovers, so check both queue age and queue depth.

During the month, responders often acknowledged alerts before opening the incident register. The history export records the acknowledger, not the reason for the acknowledgement.

Handoff date: 2025-03-03T09:00:00Z
