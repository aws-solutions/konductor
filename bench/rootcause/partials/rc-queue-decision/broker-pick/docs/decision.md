# Decision: how the order service publishes events

## Recommendation

Go with Option 3, the self-hosted message broker.

## Facts used

From `docs/context.md`: 50 events per second normally, spikes to 2,000 per second during sales, small events, consumers are billing and shipping, analytics possible later.

Assumptions: the team can run a cluster, and we want control over ordering and retention.

## Why the broker fits

- Control: we choose partitioning, retention and ordering ourselves, and a spike of 2,000 events per second is well within one small cluster.
- Portability: it runs anywhere, so we are not tied to one provider.
- Cost: virtual machines are cheap compared with managed per-message prices.

## Why the other options lost

- Option 1, managed message queue: messages are deleted after acknowledgment and the options for ordering are limited.
- Option 2, managed event stream: ties us to a provider and charges for retention.

## Costs and trade-offs

- We own upgrades, disk space and failover for the cluster.
- A broker needs at least three nodes for safety, which is a fixed monthly cost.
- Risk: an outage at night is ours to fix.
