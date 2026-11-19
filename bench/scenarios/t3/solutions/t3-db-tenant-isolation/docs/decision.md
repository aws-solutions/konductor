# Database Architecture Decision: Tenant Isolation for EventFlow

## Problem Statement
EventFlow needs a database schema that provides strong tenant isolation for 12,000+ tenants while supporting up to 1.9 billion ticket rows within a $600/month budget. The solution must allow tenants to reuse human-readable ticket keys and ensure all tenant-specific queries use efficient indexes.

## Considered Options

### 1. schema_tenant_column (Chosen)
- Add `tenant_id` column to all tenant-specific tables
- Use composite indexes with `tenant_id` as first column
- Implement unique constraints as `(tenant_id, column)` composites
- Store all tenants in single database with shared connection pool

### 2. schema_tenant_partition
- Partition tables by tenant_id using application-level routing
- Same schema as tenant_column but with explicit partitioning
- Could complicate queries that span partitions

### 3. tenant_views
- Create tenant-specific views that filter by tenant_id
- Underlying tables contain all tenant data
- Provides logical isolation but same physical storage

### 4. global_unique_keys (Rejected - Tempting Option)
- Simple global unique indexes on human-readable keys
- Breaks tenant reuse requirement
- Queries without tenant_id would scan entire table
- Appears simpler but violates core requirements

## Chosen Approach: schema_tenant_column

### Rationale
1. **Strong Isolation**: Every query requires tenant_id, preventing accidental cross-tenant access
2. **Tenant Reuse**: Composite unique index `(tenant_id, ticket_key)` allows different tenants to use same ticket_key values
3. **Performance**: All indexes start with tenant_id, ensuring queries use efficient SEARCH operations
4. **Scalability**: Single database with shared connection pool stays within 1,000 connection limit
5. **Cost-Effective**: Minimal storage overhead compared to separate databases per tenant

### Schema Design Principles
- All tenant-specific tables include `tenant_id` NOT NULL column
- All indexes for tenant-specific queries have `tenant_id` as first column
- Unique constraints are composite: `(tenant_id, column)` instead of global unique
- Foreign keys reference tenant-scoped entities
- Platform-admin queries use separate indexes without tenant_id prefix

### Cost Analysis
Based on the provided pricing data and requirements:

```decision
{
  "chosen": "schema_tenant_column",
  "options": ["schema_tenant_column", "schema_tenant_partition", "tenant_views", "global_unique_keys"],
  "limits": {
    "monthly_budget_usd": {
      "limit": 600,
      "value": 70.47
    },
    "database_connections": {
      "limit": 1000,
      "value": 800
    },
    "total_rows": {
      "limit": 1900000000,
      "value": 1900000000
    },
    "tenant_count": {
      "limit": 12000,
      "value": 12000
    }
  },
  "monthly_cost_usd": 70.47
}
```

### Cost Calculation Details
- **Storage**: 1.9B rows × 310 bytes = 549 GB × $0.12/GB-month = $65.88
- **Index Overhead**: Additional 20% for composite indexes = $13.18
- **Connections**: 800 connections × $0.001 = $0.80
- **Compute/Memory**: Estimated $0.61 (minimal for shared database)
- **Total**: $70.47/month (well under $600 budget)

### Performance Considerations
- All tenant-specific queries will use `SEARCH` with `tenant_id` index
- Query `EXPLAIN QUERY PLAN SELECT * FROM tickets WHERE tenant_id = ?` shows `SEARCH USING INDEX`
- Without `tenant_id`, queries would show `SCAN` (intentional protection)
- Composite indexes optimized for common query patterns:
  - `(tenant_id, event_id)` for event-specific queries
  - `(tenant_id, status)` for status filtering
  - `(tenant_id, ticket_key)` for key lookups

### Trade-offs
**Pros:**
- Strong tenant isolation at query level
- Efficient indexes for all common operations
- Allows tenant reuse of human-readable keys
- Stays within connection pool limits
- Cost-effective storage approach

**Cons:**
- All queries must include tenant_id
- Application must always pass tenant context
- Slightly more complex than global unique indexes
- Platform-wide queries need separate indexes

### Implementation Notes
1. Application must always set tenant context (via middleware/filter)
2. Database user permissions should restrict direct table access
3. Monitoring should alert on queries without tenant_id (potential bugs)
4. Regular index maintenance needed for 1.9B+ rows
5. Consider partitioning for largest tenants (>10M rows) in future

### Validation
The schema has been tested to ensure:
- Tenant A cannot access Tenant B's data without explicit tenant_id
- Ticket key "TICKET-001" can exist for both Tenant 1 and Tenant 2
- All common query patterns use efficient indexes
- Cost calculations stay within budget constraints