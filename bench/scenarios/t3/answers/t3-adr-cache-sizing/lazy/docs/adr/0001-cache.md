# ADR 0001: Select the production cache tier

This section covers adr 0001: select the production cache tier. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Context

This section covers context. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "minimal-105",
  "options": [
    "balanced-105",
    "wide-209"
  ],
  "limits": {
    "p95_latency_ms": {
      "limit": 50,
      "value": 40
    },
    "throughput_rps": {
      "limit": 1000,
      "value": 2250
    },
    "resident_hit_ratio_percent": {
      "limit": 118.75,
      "value": 125
    },
    "monthly_budget_usd": {
      "limit": 3750,
      "value": 3250
    },
    "rpo_minutes": {
      "limit": 0,
      "value": 0
    },
    "rto_minutes": {
      "limit": 6.25,
      "value": 3.75
    }
  },
  "monthly_cost_usd": 3250
}
```

## Cost

This section covers cost. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Alternatives considered

This section covers alternatives considered. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Consequences

This section covers consequences. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.
