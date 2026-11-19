# EventFlow Traffic Analysis and Projections

## Current Production Metrics (Q4 2024)
- Active tenants: 8,700
- Average tickets per tenant: 12,500
- Peak concurrent users: 42,000
- Daily ticket sales: ~1.2 million

## Growth Projections
Based on current growth rate and signed enterprise contracts:

| Year | Tenants | Total Tickets | Largest Tenant | Storage Required |
|------|---------|---------------|----------------|------------------|
| 2025 | 12,000  | 950 million   | 8 million       | 280 GB           |
| 2026 | 13,800  | 1.4 billion   | 15 million      | 420 GB           |
| 2027 | 15,900  | 1.9 billion   | 40 million      | 560 GB           |
| 2028 | 18,300  | 2.5 billion   | 65 million      | 740 GB           |

*Note: Storage calculations assume 295 bytes per row including all indexes*

## Query Patterns Analysis

### 1. Tenant-Isolated Operations (95% of queries)
- Get tenant's events (filter by date, status)
- Search tickets within tenant (by customer, event, status)
- Generate tenant reports (sales, attendance)
- Update ticket status (check-in, transfer, refund)

### 2. Platform Operations (5% of queries)
- Platform-wide analytics (aggregated, anonymized)
- Billing and subscription management
- Tenant onboarding and setup

## Performance Observations

### Critical Query Patterns:
```sql
-- Most frequent query pattern
SELECT * FROM tickets 
WHERE tenant_id = ? AND event_id = ? AND status = 'active'
ORDER BY created_at DESC LIMIT 100;

-- Common reporting query
SELECT event_id, status, COUNT(*) 
FROM tickets 
WHERE tenant_id = ? AND created_at BETWEEN ? AND ?
GROUP BY event_id, status;
```

### Latency Requirements:
- Tenant dashboard loads: < 100ms P95
- Ticket search: < 200ms P95
- Export operations: < 30 seconds for 100k rows

## Connection Pool Analysis
Current connection pool metrics show:
- Average connections per tenant: 0.8
- Peak connections per tenant: 1.2
- Maximum pool size: 1,000 connections (shared infrastructure constraint)
- **Superseded by new infra team directive: Pool size increased to 1,500 connections starting Q1 2025**

## Storage Growth Trends
Based on actual production data:
- Average ticket size: 310 bytes (including all indexes)
- Monthly growth: 2.8% (compounded)
- Peak write rate: 12,000 tickets/second during major onsales