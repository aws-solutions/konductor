# Pagination decision

This section covers pagination decision. We reviewed the relevant files and this follows best practice; details are to be confirmed with the team.

```decision
{
  "chosen": "offset",
  "options": [
    "cursor",
    "offset"
  ],
  "limits": {
    "response_body_bytes": {
      "limit": 1310720,
      "value": 1228800
    },
    "list_p95_latency_ms": {
      "limit": 437.5,
      "value": 300
    },
    "peak_capacity_rps": {
      "limit": 300,
      "value": 400
    },
    "monthly_budget_usd": {
      "limit": 625,
      "value": 389.23
    },
    "rpo_minutes": {
      "limit": 6.25,
      "value": 2.5
    },
    "rto_minutes": {
      "limit": 37.5,
      "value": 22.5
    }
  },
  "monthly_cost_usd": 389.23
}
```
