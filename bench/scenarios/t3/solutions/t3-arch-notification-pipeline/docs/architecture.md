# Notification fan-out architecture decision

## Decision

Use `topic-regional-queues`. The publisher writes once to the topic, and the topic routes each notification to queues in the North, Central, and South regions. Each regional queue has the production per-queue capacity, so the design has 9,000 messages per second of aggregate queue capacity against the 6,000-message-per-second peak.

```decision
{
  "chosen": "topic-regional-queues",
  "options": ["single-queue-pool", "topic-regional-queues", "stream-partitions"],
  "limits": {
    "throughput_msg_s": {"limit": 6000, "value": 9000},
    "p99_delivery_seconds": {"limit": 3, "value": 2.4},
    "monthly_budget_usd": {"limit": 4500, "value": 3539.03},
    "payload_bytes": {"limit": 2048, "value": 2048},
    "rpo_seconds": {"limit": 60, "value": 30},
    "rto_minutes": {"limit": 15, "value": 12}
  },
  "monthly_cost_usd": 3539.03
}
```

## Components

| Component | Responsibility | Sizing or placement |
|---|---|---|
| Notification publisher | Accepts and publishes each 2,048-byte notification | One logical publisher endpoint with retry-safe publish identifiers |
| Regional topic | Routes an accepted message to the regional delivery lanes | One topic spanning the three production regions |
| Regional queues | Buffer work and isolate regional worker pressure | Three queues, one per region, each sized at 3,000 messages per second |
| Delivery workers | Read, hand off, acknowledge, and retry notifications | 12 workers spread across the three availability zones |
| Offset and retry state | Records progress and supports replay after a regional incident | Retained with a 30-second recovery point |
| Monitoring and recovery automation | Tracks age, error rate, queue depth, and restarts processing | Alerts before the three-second p99 or 15-minute recovery target is missed |

## Cost check

The traffic schedule produces 5,572,800,000 messages in a 30-day month. At 2,048 bytes each, the unmultiplied transfer volume is 11,413.0944 decimal GB. For this design, four request units per message cost 2,229.12 USD, the 1.05 transfer multiplier costs 359.51 USD, and 12 workers for 720 hours cost 950.40 USD. The rounded total is 3,539.03 USD per month.

## Alternatives and tradeoffs

The single queue with a consumer pool has the lowest calculated monthly cost, but one queue provides only 3,000 messages per second. More workers cannot raise that per-queue quota, so it cannot absorb the production peak. It also leaves less room for a regional recovery event even though its latency and cost estimates are otherwise attractive.

The partitioned stream provides 8,000 messages per second and the lowest modeled p99 latency. It costs about 3,845.56 USD per month and adds partition and offset-management complexity. The selected topic and regional queues provide 9,000 messages per second, a 2.4-second modeled p99, and recovery figures within the objectives at lower modeled cost. Regional queues also give operations a clear failure boundary and a direct place to inspect backlog.

Capacity and cost should be rechecked if the message schedule, payload encoding, or regional fan-out behavior changes. The production 3,000-message-per-second quota is per queue; the superseded sandbox quota is not used for sizing.
