# Brief: Queue A or Queue B for the notification service

Built only from the notes in `sources/`. Expected load: 200 million messages a month, peaks of 2,000 messages a second.

## Recommendation

Choose Queue A, unless the notification flow needs global ordering.

## Evidence

- Capacity: Queue A carries 5,000 messages a second per partition, so one partition covers the 2,000 peak. Queue B sustains 12,000 on the upgraded cluster.
- Cost: at 200 million messages a month Queue A is about 80, Queue B is a fixed 1,200.
- Latency: Queue B is faster at p99, 25 ms against 40 ms (2025 benchmark).
- Ordering: Queue A orders per key, Queue B orders globally inside a topic.
- Operations: the vendor runs Queue A. The team patches and upgrades Queue B.

## Source quality

The Queue B figures for latency and throughput in `queue-b.md` date from 2023 and the note says they are superseded, so this brief uses the 2025 benchmark.

## Risks

Queue A's per-key ordering may not be enough if events must be globally ordered. Queue B's fixed cost is paid even at low volume.

## Open questions

Does the flow need global ordering? What growth is expected beyond 200 million a month?
