# Pagination decision

The public list contract uses cursor pagination. A cursor keeps continuation state independent of rows inserted or cancelled while a client is walking a date range. The page-size ceiling is 160 items, which keeps the largest serialized list of booking items within the production gateway envelope using the measured item size. The API still accepts a smaller client-selected page size for clients with tighter budgets.

Offset pagination is simpler for a first implementation and has a lower estimate in the price sheet, but its legacy page-size setting is not compatible with the production response envelope. The comparison also checks latency, tested capacity, recovery objectives, and the monthly estimate rather than choosing on price alone.

```decision
{
    "monthly_cost_usd": 311.38,
    "limits": {
        "rto_minutes": {
            "value": 18,
            "limit": 30
        },
        "rpo_minutes": {
            "value": 2,
            "limit": 5
        },
        "monthly_budget_usd": {
            "value": 311.38,
            "limit": 500
        },
        "peak_capacity_rps": {
            "value": 320,
            "limit": 240
        },
        "list_p95_latency_ms": {
            "value": 240,
            "limit": 350
        },
        "response_body_bytes": {
            "value": 983040,
            "limit": 1048576
        }
    },
    "options": [
        "cursor",
        "offset"
    ],
    "chosen": "cursor"
}
```
