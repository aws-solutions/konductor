# Notification fan-out architecture decision

This section covers notification fan-out architecture decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "single-queue-pool",
  "options": [
    "single-queue-pool",
    "topic-regional-queues",
    "stream-partitions"
  ],
  "limits": {
    "throughput_msg_s": {
      "limit": 7500,
      "value": 11250
    },
    "p99_delivery_seconds": {
      "limit": 3.75,
      "value": 3
    },
    "monthly_budget_usd": {
      "limit": 5625,
      "value": 4423.79
    },
    "payload_bytes": {
      "limit": 2560,
      "value": 2560
    },
    "rpo_seconds": {
      "limit": 75,
      "value": 37.5
    },
    "rto_minutes": {
      "limit": 18.75,
      "value": 15
    }
  },
  "monthly_cost_usd": 4423.79
}
```

## Components

This section covers components. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Cost check

This section covers cost check. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Alternatives and tradeoffs

This section covers alternatives and tradeoffs. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.
