# Tenant isolation decision

## Decision: notes

Use one logical ticket table with an explicit `tenant_id` on every ticket and composite tenant-first access paths. The database does not use a separate file for each customer. The application carries a trusted tenant context into every query, and the schema makes the human-readable key unique only within that context.

The unique constraint on `(tenant_id, ticket_key)` permits two tenants to use the same key while keeping a tenant-scoped key lookup selective. The status queue index begins with `(tenant_id, status, created_at)` so a queue query can seek into one tenant and status before ordering. The recent-ticket index begins with `(tenant_id, updated_at)` for the corresponding recent-change view. The same tenant prefix is present on every application-facing secondary index.

## Capacity and cost: notes

The workload contains 1,500,000,000 ticket rows and 400,000,000 support rows, or 1,900,000,000 rows total. At 310 bytes per row including indexes, the retained footprint is 589 decimal GB. Two shared capacity units at 1,400 writes per second provide 2,800 writes per second. The lookup estimate is 42 ms plus 18 ms plus 25 ms, or 85 ms at p95.

The monthly estimate is:

* storage: 589 GB × 0.12 USD = 70.68 USD
* shared capacity: 2 × 180 USD = 360 USD
* requests: 30 million × 2.50 USD = 75 USD
* database control plane: 1 × 0.004 USD = 0.004 USD
* total: 505.684 USD/month, reported as 505.68 USD/month after cent rounding

The shared deployment has a 30-second recovery point and a 10-minute recovery time. It uses one logical database, which remains within the connection-pool allocation. The per-customer-file alternative has a lower worksheet charge, but its 12,000 logical databases exceed the service's 1,000-database operational ceiling.

```decision
{
    "monthly_cost_usd": 505.68,
    "limits": {
        "logical_databases": {
            "value": 1,
            "limit": 1000
        },
        "rto_minutes": {
            "value": 10,
            "limit": 15
        },
        "rpo_seconds": {
            "value": 30,
            "limit": 60
        },
        "stored_gb": {
            "value": 589,
            "limit": 620
        },
        "monthly_cost_usd": {
            "value": 505.68,
            "limit": 600
        },
        "write_capacity_qps": {
            "value": 2800,
            "limit": 2500
        },
        "lookup_p95_ms": {
            "value": 85,
            "limit": 120
        }
    },
    "options": [
        "shared-composite",
        "tenant-database-per-customer"
    ],
    "chosen": "shared-composite"
}
```
