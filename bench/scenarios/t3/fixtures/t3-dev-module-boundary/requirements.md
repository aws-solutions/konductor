# Webhook retry service requirements

The delivery service owns outbound webhook attempts. A retry must remain available to the worker after a transient recipient failure, and the design must fit the production container rather than a developer laptop.

## Runtime envelope

| Item | Production value |
| --- | ---: |
| Container memory limit | 512 MB |
| Memory reserved for the application runtime and libraries | 200 MB |
| Memory available to retry scheduling | 312 MB |
| Retry dispatch latency, p95 | at most 60 seconds from due time |
| Sustained retry dispatch rate | at least 100 attempts per second |

The latency target is measured after an item becomes due, not from the original webhook request. An old staging profile allowed 120 seconds, but that profile was superseded by the production target above.

The component must accept the largest payload listed in the traffic profile without truncation. A durable record is preferred when a process is replaced, but the existing ingress journal supplies the service-wide recovery point; the retry design does not need to introduce a second journal.
