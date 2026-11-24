# QA traffic schedule

QA runs a repeatable gateway load test every night from 02:00 to 02:20 UTC. It originates at `198.51.100.10` and uses 50 accounts whose IDs begin with `qa-`. The test is approved by the release engineering rotation.

This note is retained for correlation with overnight alerts; it does not replace review of the authentication events.
