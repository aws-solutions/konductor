# Performance Requirements

## Latency Targets

### Write Latency
- 95th percentile: ≤ 10ms
- 99th percentile: ≤ 50ms
- Maximum acceptable: 100ms

### Read Latency
**Common queries:**
- Single record lookup: ≤ 5ms (p95)
- Time-range scans (1 hour): ≤ 100ms (p95)
- Time-range scans (24 hours): ≤ 500ms (p95)
- Full-day aggregate reports: ≤ 2 seconds (p95)

**Analytical queries:**
- Monthly trend analysis: ≤ 30 seconds
- Compliance report generation: ≤ 5 minutes

## Throughput Requirements

### Ingest Capacity
- Sustained rate: 25,000 events/second
- Peak capacity: 50,000 events/second (burst for up to 5 minutes)
- Minimum sustained: 10,000 events/second

### Query Concurrency
- Concurrent read queries: Up to 100
- Concurrent write streams: Up to 20

## Availability Targets
- Uptime: 99.95% (annual)
- RTO (Recovery Time Objective): 15 minutes
- RPO (Recovery Point Objective): 5 minutes

## Scaling Considerations
- System must scale horizontally for write throughput
- Read replicas may be used for query workload
- Storage layer must support online schema changes