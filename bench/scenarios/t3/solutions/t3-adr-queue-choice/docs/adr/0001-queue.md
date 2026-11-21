# ADR 0001: Queue Service Selection for Event Processing Pipeline

## Status
Accepted

## Context
Acme Analytics is building an event processing pipeline to handle 11 million daily events from mobile applications. Each event averages 90KB in size, and the system must sustain peak throughput of 400 events per second during marketing campaigns. The monthly budget for queue infrastructure is $900.

We need to select a managed AWS queue service that provides reliable buffering, meets performance requirements, and stays within budget.

## Decision Drivers
1. **Cost**: Must not exceed $900/month
2. **Throughput**: Must handle 400 events/second peak
3. **Message Size**: 90KB average, billed in 64KB chunks for SQS
4. **Reliability**: 99.9% availability, 99.999% durability
5. **Operational Simplicity**: Prefer managed services with minimal maintenance

## Considered Options

### Option 1: Amazon SQS Standard Queue (sqs_standard)
**Pros:**
- Unlimited throughput per queue
- At-least-once delivery semantics
- Simple pricing model
- No per-message-group throughput limits
- Mature service with extensive documentation

**Cons:**
- No guaranteed ordering (best-effort only)
- Higher cost per request compared to FIFO
- Duplicate messages possible (requires idempotent processing)

### Option 2: Amazon SQS FIFO Queue (sqs_fifo)
**Pros:**
- Exactly-once processing within 5-minute deduplication window
- Strict FIFO ordering within message groups
- Lower cost per request than standard queue ($0.45 vs $0.50 per million)
- Built-in message deduplication

**Cons:**
- Throughput limited to 300 messages/second per queue
- Requires message group design for parallel processing
- Higher latency than standard queues

### Option 3: Amazon Kinesis Data Streams (kinesis_streams)
**Pros:**
- Real-time streaming with ordered record processing per shard
- Multiple consumers can read same data
- Cost-effective for high-volume data
- Integrates well with AWS analytics services

**Cons:**
- Requires shard capacity planning
- More operational complexity than SQS
- PUT payload units billed differently (25KB chunks)

## Decision
We select **Amazon Kinesis Data Streams (kinesis_streams)** as our queue service.

### Rationale
1. **Cost Efficiency**: Kinesis is the most cost-effective option at approximately $642.56/month, well within our $900 budget.

2. **Throughput Compliance**: With 4 shards, Kinesis can handle our 400 events/second peak requirement. Each shard supports 1,000 records/second, providing 4,000 records/second total capacity.

3. **Performance**: Kinesis provides ordered processing per shard and supports multiple consumers, which aligns with our processing architecture.

4. **Future Growth**: Kinesis scales easily by adding shards, supporting our projected 25% growth over 6 months.

The tempting alternative was SQS FIFO Queue, which appears cheaper at first glance ($891 vs $990 for standard), but it fails the 400 events/second throughput requirement due to its 300 messages/second per queue limit. SQS Standard also exceeds the $900 budget at $990/month.

### Cost Calculation Details
- **Messages per month**: 11,000,000/day × 30 days = 330,000,000
- **Message size**: 90KB average
- **Kinesis configuration**: 4 shards

**Kinesis Cost Breakdown:**
- Shard hours: 4 shards × 24 hours × 30 days × $0.02/shard-hour = $57.60
- PUT payload units: 90KB ÷ 25KB/unit = 3.6 units (rounded to 4) × 330M messages ÷ 1M × $0.014 = $18.48
- Data retention: 28,324.22 GB-month × $0.02/GB = $566.48
- **Total**: $57.60 + $18.48 + $566.48 = $642.56

## Consequences

### Positive
- Within budget with approximately 71% of budget utilized
- Meets all throughput requirements
- Provides ordered processing per shard
- Supports multiple consumers for future use cases
- Integrates with AWS analytics ecosystem

### Negative
- More operational complexity than SQS
- Requires shard management and monitoring
- Learning curve for development team
- Slightly higher latency than SQS for small batches

### Neutral
- Requires implementation of checkpointing for consumer position tracking
- Need to design partition keys for even shard distribution

## Implementation Notes
1. **Shard Configuration**: Start with 4 shards, monitor usage, and scale based on actual throughput.
2. **Partition Keys**: Use mobile device ID as partition key for even distribution.
3. **Consumer Implementation**: Use Kinesis Client Library (KCL) or Lambda event source mapping.
4. **Monitoring**: Set up CloudWatch alarms for shard iterator age and read/write throughput.
5. **Error Handling**: Implement dead-letter queues for poison pills using SQS.
6. **Testing**: Load test with 400 events/second sustained for 30 minutes.

## Compliance
This decision meets all stated requirements:
- ✅ Budget: $642.56 < $900
- ✅ Throughput: 4 shards support 400 events/second
- ✅ Message size: 90KB handled within shard limits
- ✅ Availability: 99.9% SLA from AWS
- ✅ Durability: 99.999% data durability

```decision
{
  "chosen": "kinesis_streams",
  "options": ["sqs_standard", "sqs_fifo", "kinesis_streams"],
  "limits": {
    "monthly_budget_usd": {
      "limit": 900,
      "value": 642.56
    },
    "peak_throughput_per_second": {
      "limit": 400,
      "value": 400
    },
    "fifo_throughput_per_queue": {
      "limit": 300,
      "value": 0
    }
  },
  "monthly_cost_usd": 642.56
}
```