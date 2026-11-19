# Technical Implementation Constraints

## Database Recovery Constraints

### Restoration Throughput Limits
- **Maximum restore streams**: 2 concurrent streams
- **Per-stream throughput**: 1.2 GB/s (gigabytes per second)
- **Total restore bandwidth**: 2.4 GB/s maximum
- **Stream initialization overhead**: 30 seconds per stream

### Storage Performance
- **Provisioned IOPS**: 16,000 IOPS per volume
- **Maximum volume size**: 16 TB
- **Snapshot creation time**: Approximately 45 minutes for full 8 TB database
- **Snapshot restore time**: Depends on network bandwidth and storage performance

### Network Constraints
- **Cross-region link capacity**: 10 Gbps (1.25 GB/s theoretical maximum)
- **Practical throughput**: Approximately 80% of theoretical (1.0 GB/s)
- **Latency impact on replication**: Additional 70-100 ms per transaction

## Operational Constraints

### Maintenance Windows
- **Weekly maintenance**: 4 hours every Sunday 02:00-06:00 UTC
- **Quarterly DR testing**: 8 hours scheduled quarterly
- **Maximum allowed downtime for testing**: 15 minutes

### Personnel Constraints
- **DR team availability**: 2 on-call engineers
- **Maximum response time**: 15 minutes to acknowledge incident
- **Cross-training requirement**: All team members must be capable of executing DR procedures

## Compliance Requirements
- **Data must remain within US borders** for all DR scenarios
- **Encryption at rest and in transit** mandatory
- **Audit logs must be preserved** for 7 years
- **Failback procedures** must be documented and tested

## Performance SLAs
- **Application response time**: < 200 ms p95 during normal operations
- **Application response time during DR**: < 500 ms p95 acceptable
- **Data consistency**: Must maintain ACID properties during failover
- **Transaction integrity**: Zero data corruption tolerance

---

*Technical constraints documented by: Infrastructure Architecture Team*
*Last reviewed: 2024-01-20*