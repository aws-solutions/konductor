# AWS Managed Kafka (MSK) Limits

## Cluster Limits (Per Region)
- **Maximum brokers per cluster**: 15
- **Maximum storage per broker**: 16 TB
- **Maximum partitions per cluster**: 100,000
- **Maximum connections per broker**: 5,000

## Performance Limits (m5.large)
- **Maximum throughput per broker**: 100 MB/sec
- **Maximum produce requests per broker**: 5,000/sec
- **Maximum consume requests per broker**: 10,000/sec
- **Maximum partition count per broker**: 2,000

## Configuration Limits
- **Topic replication factor**: 1-3
- **Partitions per topic**: 1-100 (soft), 100-1,000 (requires ticket)
- **Message size**: 1 MB default, 10 MB max (requires configuration change)
- **Retention period**: 1 hour to 1,800 days (≈5 years)

## Our Planned Configuration
- **Broker type**: m5.large (2 vCPU, 8 GB RAM)
- **Broker count**: 3 (for HA)
- **Storage**: 1 TB GP3 per broker
- **Replication factor**: 3
- **Partitions**: 10 per topic initially

## Scaling Considerations
- **Vertical scaling**: Can upgrade to m5.xlarge with 30-minute maintenance window
- **Horizontal scaling**: Add brokers with ~15 minutes of rebalancing
- **Storage scaling**: Can increase without downtime

## Important Notes
1. **Ordering guarantees**: Only within a single partition. For cross-partition ordering, need single partition or external sequencing.
2. **Availability**: 99.9% SLA for multi-AZ clusters
3. **Backup**: No native backup - use MirrorMaker or tiered storage
4. **Monitoring**: CloudWatch metrics have 1-minute granularity
5. **Cost**: ~$400/month per broker + storage + data transfer

## Special Limits for Our Use Case
- **Maximum lag for alerting**: 10,000 messages or 5 minutes (whichever comes first)
- **Consumer group rebalance time**: Up to 3 minutes for large groups
- **Topic creation rate**: 10 topics per minute maximum
- **Configuration update**: Requires rolling restart (≈30 minutes per broker)

## Compliance Notes
- **Encryption**: TLS 1.2 required, at-rest encryption enabled
- **VPC requirements**: Must be in private subnets
- **Network limits**: 5 Gbps per broker maximum
- **IAM permissions**: Fine-grained access control available