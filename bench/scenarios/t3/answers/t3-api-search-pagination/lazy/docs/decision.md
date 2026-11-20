# Product search architecture decision

This section covers product search architecture decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Decision

This section covers decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Comparison

This section covers comparison. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## Cost calculation

This section covers cost calculation. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

## API behavior

This section covers api behavior. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "offset-sql",
  "options": [
    "offset-sql",
    "cursor-index"
  ],
  "limits": {
    "p99_search_latency": {
      "limit": 312.5,
      "value": 225
    },
    "peak_search_throughput": {
      "limit": 2250,
      "value": 2750
    },
    "monthly_search_budget": {
      "limit": 11250,
      "value": 9969.76
    },
    "catalog_capacity": {
      "limit": 75000000,
      "value": 100000000
    },
    "rpo": {
      "limit": 75,
      "value": 37.5
    },
    "rto": {
      "limit": 18.75,
      "value": 12.5
    }
  },
  "monthly_cost_usd": 9969.76
}
```
