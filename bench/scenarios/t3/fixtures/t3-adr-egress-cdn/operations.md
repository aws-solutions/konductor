# Operations and resilience expectations

The operations team can tolerate a short origin interruption because clips are immutable after publication. It still needs the delivery design to preserve the following recovery envelope:

| Measure | Limit | How it is assessed |
| --- | ---: | --- |
| Sustained viewer delivery | at least 1.5 Gbps | 15-minute load test at the forecast floor |
| Recovery point objective (RPO) | at most 15 minutes | newest metadata that may be lost after an origin incident |
| Recovery time objective (RTO) | at most 30 minutes | time to restore serving traffic |

The p95 start-time ceiling remains 800 ms for the production service. These limits apply to the public delivery path. A 2.8 Gbps lab burst is useful capacity context but is not a substitute for the sustained-throughput requirement.
