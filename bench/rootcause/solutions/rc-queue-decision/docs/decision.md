# Decision: how the order service publishes events

## Recommendation

Use Option 2, the managed event stream, with events keyed by customer id.

## Facts used

From `docs/context.md`: 50 events per second normally, spikes to 2,000 per second for 20 to 40 minutes, events under 2 KB, consumers are billing and shipping, with an analytics job possible later.

Answers received while preparing this decision:

- Events for the same customer must be processed in the order they happened. Different customers may interleave.
- Billing must be able to replay the last 7 days of events after a bug fix.
- The team is two engineers with nobody on call for infrastructure, so a fully managed service is preferred.

## Why the stream fits

- Ordering: the partition key is the customer id, so all events of one customer go to one partition and stay in order. Other customers spread across partitions.
- Replay: the log keeps events for 7 days (set retention to 8 days for margin), so billing can rewind its read position after a fix without asking the order service to resend.
- Load: the spike of 2,000 events per second at under 2 KB is about 4 MB per second, which a handful of partitions carries. Consumers read at their own pace, so billing being slow does not slow shipping.
- Operations: it is managed, so two engineers do not patch or scale a cluster.
- Later consumers: the analytics job can read the same log with its own position.

## Why the other options lost

- Option 1, managed message queue: messages are deleted once acknowledged, so there is no replay of the last 7 days. Ordering per customer needs a FIFO mode with lower throughput limits, which is tight for the 2,000 per second spike. Each new consumer needs its own queue and a fan-out step.
- Option 3, self-hosted broker: it would meet the ordering and replay needs, but a two-person team with no one on call would own upgrades, disk, failover and security patches. The operations burden is the reason to reject it.

## Costs and trade-offs

- A stream is billed by shard or partition hours and by data volume, and retention adds storage cost; with small events the 7-day storage is minor. Expect it to cost more than a basic queue at 50 events per second.
- Consumers must track their own read position and handle duplicates, because delivery is at least once.
- A hot customer can overload one partition; watch the per-partition metrics.

## Assumptions

- Prices and limits above are not taken from the context and need checking against the chosen provider.
- Retention of 7 days covers the replay need; longer replay would need an archive.
