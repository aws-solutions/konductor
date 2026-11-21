# Notification fan-out: production architecture

**Decision: `stream-partitions`.** It costs about 307 USD a month more than the regional topic, and buys the best
latency and recovery of the three, with eight independent lanes instead of three.

## Why not the others

| Option | Peak capacity | p99 | RPO | RTO | Monthly | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| single-queue-pool | 1 x 3,000 = 3,000 msg/s | 2.7 s | 45 s | 10 min | 3,439.83 | fails the 6,000 msg/s peak |
| topic-regional-queues | 3 x 3,000 = 9,000 msg/s | 2.4 s | 30 s | 12 min | 3,539.03 | works |
| stream-partitions | 8 x 1,000 = 8,000 msg/s | 2.1 s | 20 s | 8 min | 3,845.56 | works, chosen |

One queue is capped at 3,000 msg/s. More consumers do not lift that cap, so the pool cannot take a 6,000 msg/s burst.

The regional topic is cheaper, but its 9,000 msg/s is three separate 3,000 msg/s quotas. It holds only if the peak
spreads over the regions, and the packet gives no regional split. A region above 3,000 msg/s would overflow its queue.
Hashed partition keys spread load more evenly over eight lanes.

## Cost

Messages per month = (6,000 x 2 h + 1,800 x 22 h) x 3,600 s x 30 days = 5,572.8 million.

- Requests: 5,572.8 M x 4 units x 0.10 per million = 2,229.12 USD
- Transfer: 5,572.8 M x 2,048 B / 1e9 x 1.02 x 0.03 = 349.24 USD
- Workers: 16 x 720 h x 0.11 = 1,267.20 USD
- Total: 3,845.56 USD, inside the 4,500 USD budget.

## Components

| Component | Job |
| --- | --- |
| Ingest API | accepts a notification and writes it to the stream, keyed by recipient |
| Stream, 8 partitions | holds messages in order per key, 1,000 msg/s each |
| Delivery workers (16) | one lane each at a time, read a partition and send |
| Offset snapshots | every 20 s, the recovery point |

Downside: four more workers than the topic design, and a partition key that must stay well spread. If the budget
tightened below about 3,850 USD, the regional topic would be the choice.

Payloads stay at the 2,048-byte contract, under the 4,096-byte broker maximum. Sizing uses the production quota and
the 3 s objective.

```decision
{"options":["stream-partitions","topic-regional-queues","single-queue-pool"],"chosen":"stream-partitions","monthly_cost_usd":3845.56,"limits":{"rto_minutes":{"limit":15,"value":8},"rpo_seconds":{"limit":60,"value":20},"payload_bytes":{"limit":2048,"value":2048},"monthly_budget_usd":{"limit":4500,"value":3845.56},"p99_delivery_seconds":{"limit":3,"value":2.1},"throughput_msg_s":{"limit":6000,"value":8000}}}
```
