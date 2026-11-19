# Traffic notes

The current forecast has 12,000 tenants. The largest customer is expected to hold 40 million tickets, and 400 customers are expected to hold more than one million tickets each. The forecast is intentionally uneven, so an average-per-tenant calculation is not a safe indexing strategy.

| Workload | Planning figure |
| --- | ---: |
| Peak ticket reads | 1,800 requests/second |
| Peak ticket writes | 2,200 requests/second |
| Monthly ticket API requests | 30 million |
| Connection pool slots available to this service | 1,000 |

The sustained write acceptance target includes headroom above the forecast peak. Read traffic is mostly a tenant-scoped ticket-key lookup, a tenant/status queue ordered by creation time, and a tenant's recently changed tickets. The monthly request figure is the billing quantity used by the price sheet, not a promise that every second has peak traffic.
