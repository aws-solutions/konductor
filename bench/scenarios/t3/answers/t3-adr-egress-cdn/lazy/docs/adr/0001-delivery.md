# ADR 0001: Deliver published clips through a committed CDN

This section covers adr 0001: deliver published clips through a committed cdn. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Context

This section covers context. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Options and cost comparison

This section covers options and cost comparison. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "object-direct",
  "options": [
    "cdn-committed",
    "cdn-payg",
    "object-direct"
  ],
  "limits": {
    "p95_start_ms": {
      "limit": 1000,
      "value": 775
    },
    "sustained_throughput_gbps": {
      "limit": 1.88,
      "value": 3
    },
    "monthly_cost_usd": {
      "limit": 11875,
      "value": 10750
    },
    "data_size_tb": {
      "limit": 225,
      "value": 225
    },
    "rpo_minutes": {
      "limit": 18.75,
      "value": 12.5
    },
    "rto_minutes": {
      "limit": 37.5,
      "value": 25
    }
  },
  "monthly_cost_usd": 10750
}
```

## Consequences

This section covers consequences. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.
