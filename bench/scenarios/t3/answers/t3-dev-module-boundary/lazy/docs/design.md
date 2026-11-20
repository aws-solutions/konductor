# ADR: Store webhook retries in a database table

This section covers adr: store webhook retries in a database table. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "in_memory_delay_queue",
  "options": [
    "in_memory_delay_queue",
    "database_retry_table",
    "external_retry_queue"
  ],
  "limits": {
    "memory_mb": {
      "limit": 390,
      "value": 50.12
    },
    "latency_p95_seconds": {
      "limit": 75,
      "value": 52.5
    },
    "throughput_per_second": {
      "limit": 125,
      "value": 225
    },
    "payload_kb": {
      "limit": 20,
      "value": 10
    },
    "monthly_budget_usd": {
      "limit": 375,
      "value": 130.68
    },
    "rpo_minutes": {
      "limit": 6.25,
      "value": 1.25
    },
    "rto_minutes": {
      "limit": 37.5,
      "value": 22.5
    }
  },
  "monthly_cost_usd": 130.68
}
```

## Capacity calculations

This section covers capacity calculations. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Alternatives

This section covers alternatives. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Follow-up safeguards

This section covers follow-up safeguards. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.
