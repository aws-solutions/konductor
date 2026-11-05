# Decision: how the order service publishes events

## Recommendation

Choose Option 1, the managed message queue.

## Facts used

From `docs/context.md`: 50 events per second normally, spikes to 2,000 per second during sales, small events, consumers are billing and shipping.

Assumptions: nothing in the context says order matters or that old events must be read again, so neither is required.

## Why the queue fits

- Simple: each consumer gets its own queue and the service handles scaling during a sales spike of 2,000 events per second.
- Failure isolation: when billing is down its queue keeps the messages until it recovers.
- No servers: it is fully managed.

## Why the other options lost

- Option 2, managed event stream: more concepts to learn (partitions, read positions) than we need today.
- Option 3, self-hosted broker: we would have to run the cluster ourselves.

## Costs and trade-offs

- A queue costs little at this volume.
- Messages are deleted once acknowledged, so a bug fix cannot be replayed from the queue.
- Order across messages is not guaranteed.
- Adding a consumer means adding a queue and a publish step.
