# Pagination decision

The public list contract uses cursor pagination. A cursor keeps continuation state independent of rows inserted or cancelled while a client is walking a date range. The page-size ceiling is 160 items, which keeps the largest serialized list of booking items within the production gateway envelope using the measured item size. The API still accepts a smaller client-selected page size for clients with tighter budgets.

Offset pagination is simpler for a first implementation and has a lower estimate in the price sheet, but its legacy page-size setting is not compatible with the production response envelope. The comparison also checks latency, tested capacity, recovery objectives, and the monthly estimate rather than choosing on price alone.

```decision
{
  "chosen": "cursor",
  "options": ["cursor", "offset"],
  "limits": {
    "response_body_bytes": {"limit": 1048576, "value": 983040},
    "list_p95_latency_ms": {"limit": 350, "value": 240},
    "peak_capacity_rps": {"limit": 240, "value": 320},
    "monthly_budget_usd": {"limit": 500, "value": 311.38},
    "rpo_minutes": {"limit": 5, "value": 2},
    "rto_minutes": {"limit": 30, "value": 18}
  },
  "monthly_cost_usd": 311.38
}
```
