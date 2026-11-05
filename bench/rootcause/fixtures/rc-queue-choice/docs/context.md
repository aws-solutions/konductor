# Order events: how do we hand them to other services?

## What happens today

The order service writes to its database and then calls the billing service and the shipping service directly. When one of them is down, the order call fails or the event is lost.

## Load

About 50 events per second on a normal day, with spikes up to 2,000 per second during sales that last 20 to 40 minutes. Events are small (under 2 KB): order created, paid, cancelled, shipped.

## Consumers

- Billing service
- Shipping service
- Possibly an analytics job later

## Options we are looking at

1. Option 1, managed message queue. Each consumer gets its own queue. Messages are deleted once a consumer acknowledges them.
2. Option 2, managed event stream. Events are appended to a partitioned log. Each consumer reads at its own pace and the log keeps events for a configurable number of days.
3. Option 3, self-hosted message broker. We run a broker cluster on our own virtual machines.

## What I do not know yet

I have not written down anything about ordering, about how long events must be kept, or about who would run the infrastructure.
