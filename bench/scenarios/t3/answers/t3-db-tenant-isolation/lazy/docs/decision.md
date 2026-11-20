# Tenant isolation decision

This section covers tenant isolation decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Capacity and cost

This section covers capacity and cost. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "tenant-database-per-customer",
  "options": [
    "shared-composite",
    "tenant-database-per-customer"
  ],
  "limits": {
    "lookup_p95_ms": {
      "limit": 150,
      "value": 106.25
    },
    "write_capacity_qps": {
      "limit": 3125,
      "value": 3500
    },
    "monthly_cost_usd": {
      "limit": 750,
      "value": 632.1
    },
    "stored_gb": {
      "limit": 775,
      "value": 736.25
    },
    "rpo_seconds": {
      "limit": 75,
      "value": 37.5
    },
    "rto_minutes": {
      "limit": 18.75,
      "value": 12.5
    },
    "logical_databases": {
      "limit": 1250,
      "value": 1.25
    }
  },
  "monthly_cost_usd": 632.1
}
```
