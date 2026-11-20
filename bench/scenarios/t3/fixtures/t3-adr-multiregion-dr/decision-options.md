# Disaster Recovery Options Analysis

## Option 1: Nightly Backup Copy

### Architecture
- Daily full backup snapshot created at 02:00 UTC
- Snapshot copied to DR region (us-west-2)
- Minimal infrastructure in DR region (storage only)
- Manual restoration process

### Performance Characteristics
- **RPO**: 24 hours (daily backup frequency)
- **RTO**: ~57 minutes (full database restore time) + 23 minutes (application startup and validation) = ~80 minutes total
- **Data loss potential**: Up to 24 hours of transactions

### Cost Estimate (Monthly)
- Storage: 8 TB × $0.125/GB-month = $1,024
- Backup software: $450
- Testing credits: $300
- Support contract: $750
- **Total**: ~$2,524

### Pros
- Lowest cost option
- Simple implementation
- Minimal ongoing operational overhead

### Cons
- Does not meet RPO requirement (24h vs 5m)
- Does not meet RTO requirement (80m vs 45m)
- Significant data loss potential

## Option 2: Pilot Light with Continuous Replication

### Architecture
- Minimal compute instances in DR region (t3.medium)
- Continuous asynchronous data replication
- Automated failover with manual approval
- Current implementation

### Performance Characteristics
- **RPO**: ~5 minutes (replication lag)
- **RTO**: ~65 minutes (scale-up + validation)
- **Data consistency**: Near-real-time with possible replication lag

### Cost Estimate (Monthly)
- Compute (minimal): 24/7 × $0.0416/hour × 2 instances = ~$60
- Storage: 8 TB × $0.125/GB-month = $1,024
- Data transfer: 82 TB × $0.02/GB = ~$1,680
- Replication service: $2,500
- Monitoring: $800
- DR orchestration: $1,200
- Backup software: $450
- Testing: $300
- Support: $750
- **Total**: ~$8,764

### Pros
- Meets RPO requirement
- Lower cost than warm standby
- Already partially implemented

### Cons
- Exceeds RTO requirement (60m vs 45m)
- Requires significant scale-up time
- Complex failover procedure

## Option 3: Warm Standby

### Architecture
- Partial capacity in DR region (50% of production)
- Synchronous or near-synchronous replication
- Automated failover with minimal manual intervention
- Pre-warmed application instances

### Performance Characteristics
- **RPO**: < 2 minutes (near-real-time replication)
- **RTO**: ~15 minutes (automated failover + validation)
- **Data consistency**: High (minimal to no data loss)

### Cost Estimate (Monthly)
- Compute (50% capacity): ~$4,200
- Storage: 8 TB × $0.125/GB-month = $1,024
- Data transfer: 82 TB × $0.02/GB = ~$1,680
- Replication service: $2,500
- Monitoring: $800
- DR orchestration: $1,200
- Backup software: $450
- Testing: $300
- Support: $750
- **Total**: ~$11,904

### Pros
- Provides low RPO and RTO capabilities
- Automated failover reduces human error
- Minimal data loss
- Faster recovery

### Cons
- Highest cost option
- More complex implementation
- Higher ongoing operational overhead

## Comparison Summary

| Metric | Nightly Backup | Pilot Light | Warm Standby | Requirement |
|--------|----------------|-------------|--------------|-------------|
| RPO | 24 hours | 5 minutes | 2 minutes | 5 minutes |
| RTO | ~80 minutes | ~65 minutes | ~15 minutes | 45 minutes |
| Monthly Cost | ~$2,524 | ~$8,764 | ~$11,904 | ≤ $12,000 |
| Data Loss Risk | High | Moderate | Low | Minimize |
| Implementation Complexity | Low | Medium | High | - |

---

*Analysis prepared for: Q1 2024 Architecture Review*
*Next steps: Select option and create ADR*