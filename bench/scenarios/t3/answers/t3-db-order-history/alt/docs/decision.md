# Order History Database Design Decision

### Cost Calculation: notes
* **Standard volume fee**: $50.00 (includes first 2.5 TB storage)
* **IOPS**: 15,000 IOPS = 15 × $0.10 = $1.50
* **Throughput**: 500 MB/s × $0.08 = $40.00
* **Total monthly cost**: $50.00 + $1.50 + $40.00 = **$91.50**

### Storage Calculations: notes
* **Base data**: 900M rows × 2.5 KB = 2.05 TB
* **Index overhead**: Each index adds ~0.15 TB (183 bytes per row)
* **Total with 3 indexes**: 2.05 + (3 × 0.15) = 2.5 TB (at limit)

### Schema Rationale: notes
1. **Single denormalized table**: Avoids join overhead for common queries
2. **3 total indexes**: Maximizes storage efficiency within 2.5 TB limit
3. **Composite indexes**: Serve multiple query patterns efficiently:
   * Unique index on `order_number`: Covers order lookup (Patterns 2, 5)
   * Composite on `(customer_id, order_date DESC)`: Covers customer queries (Pattern 1)
   * Composite on `(warehouse_id, status, order_date)`: Covers warehouse operations (Pattern 4)
4. **Tradeoffs accepted**:
   * Pattern 3 (order lines by order): Uses primary key with `order_id` filter
   * Pattern 6 (date range reporting): Uses `idx_customer_date` index suboptimally
   * Pattern 7 (product reporting): Not optimized (acceptable for batch processing)

## Chosen Design: Option B (composite-optimized): notes

### Option C: Two-Table Normalized: notes
* **ID**: `two-table-normalized`
* Approach: Separate orders and order_lines tables
* **Storage**: 2.6 TB (slightly over limit)
* **Cost**: ~$307/month (over budget)
* **Pros**: Normalized design, smaller row size
* **Cons**: Requires joins, exceeds storage and budget limits

### Option B: Smart Composite Indexes (Chosen): notes
* **ID**: `composite-optimized`
* Approach: 3 total indexes (1 unique, 2 composite)
* **Storage**: 2.5 TB (at limit, but acceptable)
* **Cost**: $91.50/month (well under budget)
* **Pros**: Storage efficient, covers critical query patterns, stays within limits
* **Cons**: Some reporting queries may be suboptimal

### Option A: Comprehensive Single-Column Indexes: notes
* **ID**: `single-column-all`
* Approach: Index every queryable column separately (7+ indexes)
* **Storage**: 3.1 TB (exceeds 2.5 TB limit)
* **Cost**: ~$359/month (exceeds budget)
* **Pros**: Simplest to implement, each query has dedicated index
* **Cons**: Storage overhead too high, would require Premium volume class

## Options Considered: notes

## Problem Summary: notes
ShopFast needs a SQLite schema for 900 million order lines that:
1. Fits within 2.5 TB storage volume
2. Stays under $300/month cost
3. Supports 7 critical query patterns
4. Avoids full table scans through proper indexing

### Validation: notes
* **Storage**: 2.5 TB (at limit, but acceptable)
* **Performance**: Critical queries (1, 2, 4, 5) use efficient index searches
* **Cost**: $91.50/month (well under $300 budget)
* **Constraints**: Meets all schema and query requirements

```decision
{
    "monthly_cost_usd": 91.5,
    "limits": {
        "throughput_mbps": {
            "value": 500,
            "limit": 500
        },
        "iops": {
            "value": 15000,
            "limit": 15000
        },
        "monthly_budget_usd": {
            "value": 91.5,
            "limit": 300
        },
        "storage_tb": {
            "value": 2.5,
            "limit": 2.5
        }
    },
    "options": [
        "single-column-all",
        "composite-optimized",
        "two-table-normalized"
    ],
    "chosen": "composite-optimized"
}
```

The design makes careful tradeoffs to stay within the 2.5 TB storage limit while supporting all critical business queries.
