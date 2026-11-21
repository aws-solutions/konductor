# Event Queue Technical Design

## Architecture Overview
```
Mobile Apps → API Gateway → Queue Service → Lambda Processors → Data Warehouse
```

## Queue Service Options
We are evaluating three AWS managed queue services:

1. **Amazon SQS Standard Queue**
   - Unlimited throughput
   - At-least-once delivery
   - Best-effort ordering
   - No per-message fees beyond request pricing

2. **Amazon SQS FIFO Queue**
   - Exactly-once processing
   - First-In-First-Out delivery
   - Limited to 300 messages per second per queue, however many message groups are used (high-throughput mode is not enabled in this account)
   - Supports message deduplication

3. **Amazon Kinesis Data Streams**
   - Real-time streaming
   - Ordered record processing per shard
   - Requires shard capacity planning
   - Supports multiple consumers

## Capacity Planning

### Traffic Patterns
Based on historical data from our staging environment:

| Metric | Value | Notes |
|--------|-------|-------|
| Daily event count | 11,000,000 | Consistent across weekdays |
| Peak hour rate | 1,440,000 events/hour | During marketing campaigns |
| Peak second rate | 400 events/second | Sustained for up to 30 minutes |
| Average event size | 90 KB | Includes metadata and timestamps |
| Maximum event size | 256 KB | Hard limit for all options |

### Processing Requirements
- **Consumer processing rate**: 500 events/second per Lambda function
- **Number of consumers**: 2-4 Lambda functions in parallel
- **Batch size**: Up to 10 messages per batch where supported
- **Visibility timeout**: 30 seconds for reliable processing

## Performance Considerations

### Latency Analysis
| Component | Expected Latency | 95th Percentile |
|-----------|-----------------|-----------------|
| Queue ingress | < 100 ms | < 200 ms |
| Queue egress | < 50 ms | < 100 ms |
| Total queue time | < 150 ms | < 300 ms |

*Note: These latency targets assume healthy queue depth and proper capacity provisioning.*

### Throughput Limits
- SQS Standard: No inherent throughput limits
- SQS FIFO: 300 messages/second per queue, with any number of message groups (important!)
- Kinesis: Depends on shard count (each shard supports 1 MB/sec input)

## Cost Drivers
Primary cost factors:
1. Number of API requests (send, receive, delete)
2. Data volume (GB transferred)
3. Provisioned capacity (shards for Kinesis)
4. Additional features (encryption, DLQ, etc.)

## Integration Details
All queue services support:
- CloudWatch metrics for monitoring
- IAM policy integration
- Dead-letter queue configuration
- SDK support for major programming languages

## Decision Criteria
We will evaluate based on:
1. Cost within $900 monthly budget
2. Ability to handle 400 events/second peak
3. Operational simplicity
4. Integration effort with existing systems

*Reference: Initial capacity estimates assumed 500 events/second peak, but monitoring data shows actual peak is 400 events/second. The 500/s figure is outdated and should not be used for capacity planning.*