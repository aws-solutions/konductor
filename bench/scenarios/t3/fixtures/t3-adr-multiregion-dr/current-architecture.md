# Current Architecture Overview

## Production Environment (Primary Region: us-east-1)

### Database Tier
- **Primary database cluster**: 3-node PostgreSQL 15 with TimescaleDB
- **Storage**: 8 TB SSD distributed across 3 volumes
- **Replication**: Streaming replication to 2 read replicas
- **Backup strategy**: Daily incremental + weekly full to S3

### Application Tier
- **Microservices**: 12 containerized services
- **Orchestration**: Kubernetes (EKS) with 24 worker nodes
- **Load balancing**: Application Load Balancer with WAF
- **Caching**: Redis cluster (3 nodes, 128 GB total)

### Monitoring and Observability
- **Metrics collection**: Prometheus + Grafana
- **Log aggregation**: CloudWatch Logs
- **Alerting**: PagerDuty integration
- **APM**: DataDog for application performance monitoring

## Current Disaster Recovery Implementation

### Pilot Light Setup (us-west-2)
- **Minimal infrastructure**: t3.medium instances for core services
- **Data replication**: Continuous asynchronous replication
- **RPO**: Approximately 5 minutes
- **RTO**: Estimated 60 minutes (based on last test)

### Backup Strategy
- **Frequency**: Daily incremental backups at 02:00 UTC
- **Retention**: 30 days in S3 Standard-IA
- **Cross-region copy**: Weekly full backup copied to us-west-2
- **Verification**: Automated restore testing monthly

## Known Issues and Limitations

### Performance Constraints
1. **Restore throughput limitation**: Current architecture supports maximum 2 restore streams at 1.2 GB/s each
2. **Network bottleneck**: Cross-region bandwidth limits replication speed
3. **Cost concerns**: Current monthly DR spend is $8,500, approaching budget limits

### Operational Gaps
1. **Manual intervention required** for failover decision
2. **Data validation** post-restore takes 15+ minutes
3. **Limited testing frequency** due to cost and complexity

### Compliance Gaps
1. **RTO of 60 minutes** exceeds business requirement of 45 minutes
2. **RPO verification** not fully automated
3. **Audit trail** for DR events needs improvement

## Architecture Evolution Timeline
- **2022-Q4**: Initial single-region deployment
- **2023-Q2**: Added cross-region backups (nightly)
- **2023-Q4**: Implemented pilot light DR (current)
- **2024-Q1**: Planning enhanced DR solution

---

*Architecture documentation version: 3.2*
*Next review scheduled: 2024-02-15*