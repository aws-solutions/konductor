# Prototype Testing Results

## Test Environment
- **Database**: SQLite 3.45.1
- **Test data**: 50 million order lines (5.5% of production volume)
- **Hardware**: 8 vCPU, 32 GB RAM, NVMe storage
- **Test duration**: 72 hours continuous

## Schema Options Tested

### Option 1: Single-Column Indexes
- Single table with all columns
- 14 single-column indexes (one per queryable column)
- **Storage**: 1.72 TB projected to 3.1 TB at 900M rows
- **Performance**: see Query Latency below

### Option 2: Composite Indexes
- Single table with 3 composite indexes
- **Storage**: 1.39 TB projected to 2.5 TB at 900M rows
- **Performance**: see Query Latency below

### Option 3: Two-Table Normalized
- Orders and order_lines tables
- Foreign key relationship
- **Storage**: 1.45 TB projected to 2.6 TB at 900M rows
- **Performance**: see Query Latency below

## Performance Metrics

### Query Latency (P95 in milliseconds)

| Query Pattern | Option 1 | Option 2 | Option 3 |
|---------------|----------|----------|----------|
| Customer orders | 85ms | 42ms | 128ms |
| Order lookup | 18ms | 15ms | 22ms |
| Order lines | 35ms | 28ms | 41ms |
| Warehouse open | 92ms | 65ms | 105ms |
| Date range | 185ms | 210ms | 195ms |

### Storage Efficiency

| Metric | Option 1 | Option 2 | Option 3 |
|--------|----------|----------|----------|
| Data size | 0.86 TB | 0.86 TB | 0.86 TB |
| Index size | 0.86 TB | 0.53 TB | 0.59 TB |
| Total | 1.72 TB | 1.39 TB | 1.45 TB |
| Projected to 900M | 3.10 TB | 2.50 TB | 2.61 TB |

## Storage Calculation Details

### Base Row Size Analysis
Average row composition:
- Order metadata: 120 bytes
- Product details: 80 bytes
- Line item details: 40 bytes
- Customer/shipping: 60 bytes
- **Total**: ~300 bytes raw data
- **With SQLite overhead**: ~350 bytes
- **With primary key index**: ~400 bytes per row

### Index Entry Size Analysis
- Single-column index entry: ~45 bytes
- Composite index (2 columns): ~65 bytes
- Composite index (3 columns): ~85 bytes
