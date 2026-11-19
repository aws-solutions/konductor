# On-call notes

Normal response checks include the gateway 5xx rate, upstream latency, container restarts, and memory headroom. Compare the canary container with the release cohort before treating a traffic change as a service change.

A restart can remove a short-lived error burst without removing the condition that caused it. Preserve the first warning and the container lifecycle lines when collecting evidence.
