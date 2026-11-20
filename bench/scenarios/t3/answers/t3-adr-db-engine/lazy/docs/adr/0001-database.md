# ADR 0001: Select the session-store database

This section covers adr 0001: select the session-store database. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Context

This section covers context. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "kv-on-demand",
  "options": [
    "kv-on-demand",
    "kv-provisioned-autoscaling",
    "relational-cluster"
  ],
  "limits": {
    "peak_write_wps": {
      "limit": 31250,
      "value": 37500
    },
    "read_p99_ms": {
      "limit": 18.75,
      "value": 13.75
    },
    "monthly_budget_usd": {
      "limit": 8750,
      "value": 8175
    },
    "item_size_bytes": {
      "limit": 1280,
      "value": 1280
    },
    "rpo_seconds": {
      "limit": 75,
      "value": 56.25
    },
    "rto_seconds": {
      "limit": 375,
      "value": 300
    },
    "partition_write_wcu": {
      "limit": 1250,
      "value": 1171.88
    }
  },
  "monthly_cost_usd": 8175
}
```

## Alternatives considered

This section covers alternatives considered. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Key-value table on-demand

This section covers key-value table on-demand. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

### Relational cluster

This section covers relational cluster. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Consequences

This section covers consequences. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.
