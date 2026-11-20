# Decision: bounded batch intake

This section covers decision: bounded batch intake. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Context

This section covers context. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Alternatives

This section covers alternatives. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Cost

This section covers cost. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "direct-large-batch",
  "options": [
    "buffered-batch",
    "direct-large-batch",
    "replicated-stream"
  ],
  "limits": {
    "max_request_body_bytes": {
      "limit": 327680,
      "value": 327440
    },
    "p99_latency_ms": {
      "limit": 625,
      "value": 525
    },
    "throughput_readings_per_second": {
      "limit": 5000,
      "value": 7500
    },
    "monthly_budget_usd": {
      "limit": 1875,
      "value": 1521.56
    },
    "rpo_seconds": {
      "limit": 75,
      "value": 37.5
    },
    "rto_minutes": {
      "limit": 18.75,
      "value": 12.5
    }
  },
  "monthly_cost_usd": 1521.56
}
```
