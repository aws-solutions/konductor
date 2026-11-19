# Traffic Analysis and Sizing

## Current Usage Patterns

### Query Volume (24-hour average)
- Customer order lookups: 2.5 million queries/day
- Order detail views: 1.8 million queries/day  
- Warehouse status checks: 750,000 queries/day
- Financial reports: 50 batch jobs/day

### Peak Load Characteristics
- Black Friday peak: 10× normal volume
- Month-end reporting: 5× financial query volume
- Daily business hours (9 AM - 5 PM): 2× average load

### Data Access Patterns Analysis

#### By Customer ID (Query Pattern 1)
- Most frequently accessed: recent 30 days of orders
- 80% of queries target last 90 days
- Requires efficient sorting by order date descending

#### By Order Number (Query Pattern 2)
- Exact lookups, low cardinality search
- Critical for customer service and warehouse ops
- Must support sub-millisecond response

#### By Order ID for Lines (Query Pattern 3)
- Each order has 1-15 line items (avg: 3.2)
- Need efficient join or denormalized access

#### By Warehouse + Status (Query Pattern 4)
- 12 warehouses nationwide
- Open orders represent ~5% of total at any time
- Warehouse staff need real-time visibility

#### By Date Range (Query Pattern 6)
- Financial team runs daily, weekly, monthly reports
- Typically scans 1-30 days of data
- Batch processing during off-hours

## Storage Calculations

### Base Data Size
- 900 million order lines × 2.5 KB = **2.05 TB**
- Note: This figure includes basic row storage with primary key

### Index Overhead Estimates
Based on our prototype testing with sample data:
- Single-column index: adds ~180 bytes per row
- Composite indexes (2-3 columns): similar overhead to single-column
- Total storage = data + Σ(indexes × rows × index_entry_size)

### Growth Projections
- **Year 1**: 900M + (3M × 365) = 2.0 billion rows
- **Year 2**: Additional 1.1 billion rows
- **Year 3**: At retention limit, oldest data purged

## Performance Benchmarks

### Test Results (Prototype Environment)
| Query Pattern | Avg Latency | 95th %ile | Index Used |
|---------------|-------------|-----------|------------|
| Customer orders | 45ms | 120ms | (customer_id, order_date) |
| Order lookup | 12ms | 35ms | order_number |
| Order lines | 28ms | 75ms | order_id |
| Warehouse open | 67ms | 180ms | (warehouse_id, status) |
| Date range | 210ms | 450ms | order_date |

**Note**: These benchmarks were run on development hardware with 50M rows. Production scaling will require careful index design to maintain performance at 900M+ rows.

### Legacy System Limitations
- Current system uses 14 separate indexes (one per queryable column)
- Storage consumption: **3.1 TB** (exceeds new budget)
- Query performance degrades during month-end reporting
- Maintenance windows required for index rebuilds

## Recommendations
1. Prioritize composite indexes over single-column indexes
2. Consider partial indexes for low-cardinality columns (e.g., status)
3. Implement table partitioning by date for older data
4. **Critical**: Total storage must not exceed 2.5 TB volume limit