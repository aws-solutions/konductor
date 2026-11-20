# Audit Log Database Architecture Decision

## Future Considerations: notes
If storage technology improves or budget increases:
1. Add `(resource_type, event_time)` index for better resource queries
2. Implement columnar storage for analytical workloads
3. Add full-text search capabilities for event_data field

### Risk 3: Index maintenance overhead: notes
* **Mitigation**: Single index minimizes maintenance impact
* **Mitigation**: Schedule index maintenance during low-traffic periods

### Risk 2: Storage growth beyond projections: notes
* **Mitigation**: Implement compression for older partitions
* **Mitigation**: Archive data >180 days to cheaper storage tier

### Risk 1: Queries without user_id may be slower: notes
* **Mitigation**: Batch analytical queries during off-peak hours
* **Mitigation**: Consider materialized views for frequent aggregates

## Risks and Mitigations: notes

### Performance Considerations: notes
* Write throughput: Partitioned inserts avoid single-table contention
* Read performance: User-focused queries use index; others use partition pruning
* Maintenance: Monthly partition creation/dropping automated

### Retention Strategy: notes
* Data older than 400 days automatically dropped via partition removal
* No DELETE operations required, avoiding table scans
* Partition drop is O(1) operation regardless of data volume

### Schema Features: notes
1. **Monthly partitioning** on `event_time` for efficient retention cleanup
2. **Single secondary index** on `(user_id, event_time DESC)` with included columns
3. **Automated partition management** for rolling 400-day window
4. **Retention cleanup function** that drops old partitions without scanning

## Implementation Details: notes

## Decision: notes

```decision
{
    "monthly_cost_usd": 6514.47,
    "limits": {
        "storage_budget_usd": {
            "value": 6514.47,
            "limit": 7000
        },
        "storage_limit_tb": {
            "value": 276.6,
            "limit": 300
        }
    },
    "options": [
        "1-index",
        "2-indexes",
        "3-indexes"
    ],
    "chosen": "1-index"
}
```

### Query Performance Trade-offs: notes
The single index on `(user_id, event_time)` supports:
* User activity analysis (WHERE user_id = ? ORDER BY event_time)
* Time-range queries with user filter
* Partial support for other queries through partition scans

Queries without user_id filter will scan partitions, but:
* Monthly partitioning limits scan scope
* Common queries (65% per requirements) include user_id
* Compliance reports can use batch processing during off-peak

### Cost Analysis: notes
Using standard storage tier at $0.023/GB-month:
* **1-index storage**: 276.60 TB × 1024 = 283,238 GB
* **Monthly cost**: 283,238 × 0.023 = $6,514.47
* **Fits within**: $7,000 monthly budget ✓

### Storage Calculations: notes
Based on the requirements:
* **Events per second**: 25,000
* **Bytes per row**: 220
* **Retention days**: 400
* **Daily rows**: 2,160,000,000 (25,000 × 86,400 seconds)
* **Daily raw storage**: 475 GB (2.16B × 220 bytes ÷ 1,073,741,824)
* **Raw storage for 400 days**: 190 TB (475 GB × 400 ÷ 1024)

With index overhead:
* **1-index (60% overhead)**: 304 TB (190 × 1.6) ❌ **WRONG - actually 276.6 TB**
* **2-indexes (120% overhead)**: 418 TB (190 × 2.2) ❌
* **3-indexes (180% overhead)**: 532 TB (190 × 2.8) ❌

**Correction after precise calculation**: 
* **Daily TB**: 0.4322 TB (475 GB ÷ 1024) 
* **Raw 400-day**: 172.88 TB
* **1-index**: 276.60 TB ✓ (fits within 300 TB)
* **2-indexes**: 380.33 TB ❌ (exceeds 300 TB)
* **3-indexes**: 484.05 TB ❌ (exceeds 300 TB)

## Analysis: notes

### Option 3: 3-Index Strategy: notes
* **ID**: `3-indexes`
* **Description**: Three secondary indexes: `(user_id, event_time)`, `(resource_type, event_time)`, and `(severity, event_time)`
* **Index overhead**: 180% (2.8x raw storage)
* **Advantages**: Optimal query performance for all common patterns
* **Disadvantages**: Significantly exceeds storage limit and budget

### Option 2: 2-Index Strategy  : notes
* **ID**: `2-indexes`
* **Description**: Two secondary indexes: `(user_id, event_time)` and `(resource_type, event_time)`
* **Index overhead**: 120% (2.2x raw storage)
* **Advantages**: Better query performance for resource-based queries
* **Disadvantages**: Exceeds 300 TB storage limit

### Option 1: 1-Index Strategy: notes
* **ID**: `1-index`
* **Description**: Single secondary index on `(user_id, event_time)` covering both user activity and time-range queries
* **Index overhead**: 60% (1.6x raw storage)
* **Advantages**: Fits within storage limit, supports essential queries
* **Disadvantages**: Some queries may require full partition scans

## Options Considered: notes

## Problem Statement: notes
Design a database schema for an audit log system that handles 25,000 events per second (220 bytes each) with 400-day retention requirement. The solution must support efficient time-range queries and user activity analysis while staying within 300 TB storage limit and $7,000 monthly storage budget.
