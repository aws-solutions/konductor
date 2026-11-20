# Event Queue Operations Runbook

## Monitoring and Alerts

### Key Metrics to Monitor
1. **Queue Depth** (NumberOfMessagesSent, NumberOfMessagesReceived)
   - Warning: > 10,000 messages
   - Critical: > 50,000 messages
   
2. **Message Age** (ApproximateAgeOfOldestMessage)
   - Warning: > 30 seconds
   - Critical: > 5 minutes
   
3. **Throughput** (NumberOfMessagesSent per minute)
   - Expected average: ~5,556 messages/minute (8M/day)
   - Peak expected: 24,000 messages/minute (400/second)

4. **Error Rates** (NumberOfEmptyReceives, NumberOfMessagesDeleted)
   - Warning: > 1% error rate
   - Critical: > 5% error rate

### Alert Configuration
```yaml
Alarms:
  - HighQueueDepth:
      Metric: NumberOfMessagesVisible
      Threshold: 10000
      Period: 5 minutes
      EvaluationPeriods: 2
  
  - OldMessages:
      Metric: ApproximateAgeOfOldestMessage
      Threshold: 30000  # 30 seconds in milliseconds
      Period: 1 minute
      EvaluationPeriods: 3
  
  - LowThroughput:
      Metric: NumberOfMessagesSent
      Threshold: 1000  # messages per minute minimum
      Comparison: LessThanThreshold
      Period: 15 minutes
      EvaluationPeriods: 2
```

## Capacity Planning

### Monthly Volume Projections
| Month | Projected Events | Growth Rate | Notes |
|-------|------------------|-------------|-------|
| Current | 11,000,000/day | - | Baseline |
| +3 months | 12,100,000/day | 10% | New feature launch |
| +6 months | 13,750,000/day | 25% | Market expansion |

### Scaling Triggers
1. **SQS Standard/FIFO**: Scale consumers based on queue depth
   - Add consumer when depth > 5,000 for 5 minutes
   - Remove consumer when depth < 100 for 15 minutes
   
2. **Kinesis**: Scale shards based on write throughput
   - Add shard when write throughput > 70% of capacity
   - Consider scaling when sustained at > 50% for 1 hour

## Performance Testing Results

### Load Test Summary (Staging Environment)
| Test Scenario | Messages/sec | Avg Latency | P95 Latency | Success Rate |
|---------------|--------------|-------------|-------------|--------------|
| Baseline (200/s) | 200 | 128ms | 195ms | 99.99% |
| Peak Load (400/s) | 400 | 142ms | 218ms | 99.98% |
| Stress Test (600/s) | 600 | 189ms | 305ms | 99.95% |

### Throughput Limits Observed
- **SQS Standard**: Handled 1000 messages/second without issue
- **SQS FIFO**: Reached limit at 300 messages/second (single message group)
- **Kinesis (4 shards)**: Sustained 400 messages/second at 65% capacity

*Note: The stress test at 600 messages/second exceeded our requirements but was conducted to understand system limits. Actual production peak is 400 messages/second.*

## Cost Monitoring

### Monthly Cost Breakdown (Estimated)
| Component | Estimated Cost | % of Budget | Alert Threshold |
|-----------|----------------|-------------|-----------------|
| Queue Requests | $400-$800 | 45-90% | $810 (90% of budget) |
| Data Transfer | $0-$50 | 0-6% | $100 |
| Monitoring | $10-$20 | 1-2% | $50 |
| **Total** | **$410-$870** | **46-97%** | **$900** |

### Cost Optimization Opportunities
1. Implement message batching to reduce request count
2. Compress messages > 32KB to reduce chunk count
3. Use appropriate retention periods (24h default)
4. Right-size consumers to match actual throughput

## Disaster Recovery

### Recovery Procedures
1. **Queue Unavailable**: Failover to secondary region (15 minute RTO)
2. **Data Loss**: Restore from backup (1 hour RPO)
3. **Throughput Degradation**: Scale consumers immediately

### Backup Strategy
- Daily snapshot of queue configuration
- Real-time replication to secondary region for critical queues
- 7-day retention of CloudWatch metrics for analysis

## Maintenance Schedule
- Weekly: Review cost reports and optimization opportunities
- Monthly: Capacity planning review based on growth trends
- Quarterly: Performance testing with increased load
- Biannually: Disaster recovery drill

*Historical context: Initial operations plan assumed 500 messages/second as peak load, but production monitoring shows actual peak is 400 messages/second. Update all runbooks to reflect current reality.*