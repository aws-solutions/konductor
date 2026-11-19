# Query Pattern Analysis

## Common Query Types

### 1. Time-Range Queries (Most Frequent - 65% of queries)
```
SELECT * FROM audit_logs 
WHERE event_time BETWEEN ? AND ? 
ORDER BY event_time DESC
```
- Typical range: 1 hour to 24 hours
- Often filtered by user_id or resource_type

### 2. User Activity Analysis (20% of queries)
```
SELECT user_id, action, COUNT(*) as count
FROM audit_logs 
WHERE user_id = ? 
  AND event_time > ?
GROUP BY user_id, action
ORDER BY count DESC
```

### 3. Security Incident Investigation (10% of queries)
```
SELECT * FROM audit_logs
WHERE severity = 'HIGH'
  AND event_time BETWEEN ? AND ?
ORDER BY event_time
```

### 4. Compliance Reporting (5% of queries)
```
SELECT DATE(event_time) as day,
       resource_type,
       COUNT(*) as event_count
FROM audit_logs
WHERE event_time BETWEEN ? AND ?
GROUP BY DATE(event_time), resource_type
```

## Index Requirements

### Must-Have Indexes
Based on query patterns, the following indexes are essential:

1. **Primary time-based access**: `(event_time)` for range queries
2. **User activity analysis**: `(user_id, event_time)` for user-specific queries
3. **Resource-based queries**: `(resource_type, event_time)` for resource-focused analysis

### Optional Indexes
- `(severity, event_time)` for security investigations
- `(action, event_time)` for action-specific analysis
- `(source_ip, event_time)` for network-based investigations

## Performance Expectations
- **Index scan should be SEARCH, not SCAN** for common queries
- **Covering indexes** preferred to avoid table lookups
- **Composite indexes** should match common filter combinations

## Retention Deletion Pattern
- Delete data older than retention period
- Should delete by time bucket (monthly partitions)
- Must not require full table scan
- Should use partition dropping or indexed range delete