# Output sections: worked templates

Read this when writing the design report; each H2 here matches an H2 in the SKILL.md output skeleton.

## Table Schema

### Table: [TableName]

**Partition Key:**

- Attribute: `[attributeName]` (Type: [S/N/B])
- Cardinality: [High/Medium/Low] ([estimated unique values])
- Justification: [Why this attribute was chosen - explain distribution and access pattern alignment]

**Sort Key:** [if applicable]

- Attribute: `[attributeName]` (Type: [S/N/B])
- Pattern: [e.g., "timestamp", "status#timestamp", "TYPE#id"]
- Justification: [Why this pattern - explain range query support and hierarchical data needs]

### Attributes

| Attribute | Type | Description            | Required | Notes                               |
| --------- | ---- | ---------------------- | -------- | ----------------------------------- |
| userId    | S    | Unique user identifier | Yes      | Partition key                       |
| email     | S    | User email address     | Yes      | Used in GSI for login               |
| createdAt | N    | Unix timestamp         | Yes      | Sort key for time-based queries     |
| profile   | M    | User profile data      | No       | Map containing nested attributes    |
| status    | S    | Account status         | Yes      | Values: active, inactive, suspended |
| lastLogin | N    | Last login timestamp   | No       | Updated on each login               |

## Index Strategy

### GSI-1: [IndexName]

**Purpose:** [Clear description of what queries this index supports]

**Configuration:**

- Partition Key: `[attribute]` (Type: [S/N/B])
- Sort Key: `[attribute]` (Type: [S/N/B]) [if applicable]
- Projection: [KEYS_ONLY / INCLUDE / ALL]
- Projected Attributes: [list if using INCLUDE]

**Access Patterns Supported:**

**Sparse Index:** [Yes/No]

- [If yes, explain which items are included and why]

**Capacity Estimate (Theoretical):**

- Read Capacity: [X] RCU ([calculation with assumptions])
- Write Capacity: [X] WCU ([calculation with assumptions])
- Storage Overhead: [X]% ([explanation])
- **Confidence Level:** [High/Medium/Low]
- **Validation Required:** Monitor actual `ConsumedReadCapacityUnits` and `ConsumedWriteCapacityUnits` in CloudWatch for 7 days

### GSI-2: [IndexName]

[Repeat structure for additional indexes]

### LSI-1: [IndexName] [if applicable]

[Same structure as GSI]

## Access Pattern Mapping

| Access Pattern    | Implementation  | Example Query                                           | Frequency (Estimated) | Expected Latency (Estimated) | Confidence | Validation Required |
| ----------------- | --------------- | ------------------------------------------------------- | --------------------- | ---------------------------- | ---------- | ------------------- |
| Get user by ID    | Primary key     | `GetItem(PK=userId)`                                    | High (1000/sec)       | <10ms (p99)                  | High       | Load testing        |
| Get user by email | GSI-1           | `Query(IndexName=EmailIndex, PK=email)`                 | Medium (100/sec)      | <50ms (p99)                  | Medium     | Load testing        |
| List users by org | Sort key prefix | `Query(PK=orgId, SK begins_with "USER#")`               | Low (10/sec)          | <100ms (p99)                 | Medium     | Load testing        |
| List recent users | GSI-2           | `Query(IndexName=TimeIndex, PK=status, SK > timestamp)` | Low (5/sec)           | <100ms (p99)                 | Low        | Load testing        |

**Performance Estimate Sources:**

- **GetItem latency (<10ms):** AWS DynamoDB Service Level Agreement for single-item reads
- **Query latency (<50-100ms):** AWS documentation + industry benchmarks (assumes <100 items returned)
- **Frequency estimates:** Based on provided requirements or typical application patterns
- **Confidence levels:**
  - High: AWS published SLA, well-documented performance characteristics
  - Medium: Based on AWS documentation but varies with data volume and query complexity
  - Low: Highly variable, depends on table size, filters, and provisioned capacity

**CRITICAL:** These are estimates, not measurements. Actual performance must be validated through load testing with production-like data volumes.

## Design Decisions

### Single Table vs Multiple Tables

**Decision:** [Single table / Multiple tables]

**Rationale:**
[Detailed explanation of why this approach was chosen]

**Tradeoffs:**

- **Advantages:** [What we gain with this approach]
- **Disadvantages:** [What we lose or complicate]
- **Alternatives Considered:** [Other options and why they were rejected]

### Partition Key Selection

**Decision:** [Chosen attribute]

**Cardinality Analysis:**

- Estimated unique values: [X]
- Distribution pattern: [Even / Skewed with mitigation]
- Hot partition risk: [Low / Medium / High] - [Mitigation strategy]

**Alternatives Considered:**

- [Option 1]: [Why rejected - e.g., low cardinality, uneven distribution]
- [Option 2]: [Why rejected - e.g., doesn't align with primary access pattern]

**Why Chosen:**
[Detailed justification including cardinality analysis, distribution expectations, and access pattern alignment]

### Sort Key Pattern

**Decision:** [Chosen pattern]

**Rationale:**
[Explain how this pattern supports required range queries and hierarchical data needs]

### Index Strategy

**Decision:** [Number and type of indexes]

**GSI vs LSI Decisions:**

For each index, document:

- **[IndexName]**: [GSI / LSI]
  - **Why this type**: [Justification based on decision framework]
  - **Cardinality**: [For GSI partition key - must be high]
  - **Consistency needs**: [Eventually consistent acceptable / Strongly consistent required]
  - **Size constraints**: [For LSI - validated < 10GB per partition]

**Rationale:**
[Explain why these specific indexes were chosen, why sparse indexes were used, and projection decisions]

**Validation Results:**

- [ ] All GSI partition keys have high cardinality (> 1000 unique values)
- [ ] All LSI partitions validated < 10GB with growth projections
- [ ] Index count within best practice limits (≤ 5 GSIs, ≤ 3 LSIs)
- [ ] Projection types optimized (not defaulting to ALL)
- [ ] GSI capacity ≥ base table write capacity
- [ ] No common pitfalls identified (low cardinality, over-indexing, etc.)

**Identified Risks:**

[List any design risks and mitigation strategies]

- Risk: [Description]
  - Mitigation: [Strategy]
  - Monitoring: [Metrics to watch]

## Capacity Planning

### Estimated Throughput (Theoretical Calculations)

**IMPORTANT:** These are theoretical estimates based on assumed traffic patterns and item sizes. Actual capacity requirements must be measured in production.

**Read Operations (Estimated):**

- Primary key reads: [X] reads/sec × [Y] KB per item / 4 KB = [Z] RCU
  - **Assumption:** [Y] KB average item size, eventually consistent reads
  - **Confidence:** [High/Medium/Low]
- GSI-1 reads: [X] reads/sec × [Y] KB per item / 4 KB = [Z] RCU
  - **Assumption:** [Y] KB projected attributes, eventually consistent reads
  - **Confidence:** [High/Medium/Low]
- GSI-2 reads: [X] reads/sec × [Y] KB per item / 4 KB = [Z] RCU
  - **Assumption:** [Y] KB projected attributes, eventually consistent reads
  - **Confidence:** [High/Medium/Low]
- **Total Read Capacity (Estimated):** [X] RCU

**Write Operations (Estimated):**

- Base table writes: [X] writes/sec × [Y] KB per item / 1 KB = [Z] WCU
  - **Assumption:** [Y] KB average item size
  - **Confidence:** [High/Medium/Low]
- GSI-1 writes: [X] writes/sec × [Y] KB per item / 1 KB = [Z] WCU
  - **Note:** Same write rate as base table (all items indexed)
- GSI-2 writes: [X] writes/sec × [Y] KB per item / 1 KB = [Z] WCU
  - **Note:** [Sparse index - only X% of items] OR [Same as base table]
- **Total Write Capacity (Estimated):** [X] WCU (base) + [Y] WCU (indexes)

**Storage (Estimated):**

- Base table: [X] items × [Y] KB average = [Z] GB
  - **Assumption:** [Y] KB average item size based on schema
- GSI-1 overhead: [X]% = [Y] GB
  - **Calculation:** [INCLUDE/ALL/KEYS_ONLY projection] + [list projected attributes]
- GSI-2 overhead: [X]% = [Y] GB
  - **Calculation:** [INCLUDE/ALL/KEYS_ONLY projection] + [sparse index factor if applicable]
- **Total Storage (Estimated):** [X] GB

**Validation Plan:**

1. **Week 1:** Deploy with 2× estimated capacity, monitor actual consumption
2. **Week 2-4:** Adjust capacity based on CloudWatch metrics (`ConsumedReadCapacityUnits`, `ConsumedWriteCapacityUnits`)
3. **Month 2:** Right-size capacity to actual usage + 20% headroom
4. **Ongoing:** Review capacity monthly, adjust for growth trends

### Cost Estimate (Monthly, US East 1)

**IMPORTANT:** These are theoretical cost estimates based on assumed traffic patterns. Actual costs may vary by ±50% or more. Enable AWS Cost Explorer and set up billing alarms to track actual spending.

**On-Demand Mode (Estimated):**

- Read requests: [X] million reads × $0.25 per million = $[Y]
  - **Assumption:** [X] reads/sec × 2,592,000 sec/month
  - **Confidence:** [High/Medium/Low] - depends on actual traffic patterns
- Write requests: [X] million writes × $1.25 per million = $[Y]
  - **Assumption:** [X] writes/sec × 2,592,000 sec/month
  - **Confidence:** [High/Medium/Low] - depends on actual traffic patterns
- Storage: [X] GB × $0.25 per GB = $[Y]
  - **Assumption:** [X] GB total storage (base + GSIs)
  - **Confidence:** [High/Medium/Low] - depends on actual item sizes
- **Total On-Demand (Estimated):** $[X] per month
- **Likely Range:** $[X × 0.5] - $[X × 1.5] per month

**Provisioned Mode (Estimated):**

- Read capacity: [X] RCU × $0.00013 per hour × 730 hours = $[Y]
  - **Assumption:** [X] RCU provisioned continuously
  - **Confidence:** [High/Medium/Low]
- Write capacity: [X] WCU × $0.00065 per hour × 730 hours = $[Y]
  - **Assumption:** [X] WCU provisioned continuously
  - **Confidence:** [High/Medium/Low]
- Storage: [X] GB × $0.25 per GB = $[Y]
  - **Assumption:** [X] GB total storage (base + GSIs)
  - **Confidence:** [High/Medium/Low]
- **Total Provisioned (Estimated):** $[X] per month
- **Likely Range:** $[X × 0.8] - $[X × 1.2] per month (more predictable than on-demand)

**Recommendation:** [On-Demand / Provisioned]

**Rationale:**
[Explain why this billing mode is recommended based on traffic patterns, predictability, and cost analysis]

**Cost Validation Plan:**

1. **Set Billing Alarms:**
   - Alert at 50% of estimated monthly cost
   - Alert at 80% of estimated monthly cost
   - Alert at 100% of estimated monthly cost

2. **Monitor Daily Costs:**
   - Enable AWS Cost Explorer
   - Review DynamoDB costs daily for first 2 weeks
   - Compare actual vs estimated costs weekly

3. **Optimize After 30 Days:**
   - Review actual traffic patterns
   - Switch billing modes if cost difference > 20%
   - Adjust provisioned capacity based on actual usage

4. **Quarterly Cost Review:**
   - Analyze cost trends
   - Identify optimization opportunities (reserved capacity, right-sizing)
   - Update cost estimates based on actual data

### Scaling Considerations

**Traffic Growth:**

- Current: [X] requests/sec
- 6 months: [Y] requests/sec (projected)
- 12 months: [Z] requests/sec (projected)

**Scaling Strategy:**

- [On-demand: Automatic scaling / Provisioned: Auto-scaling policies]
- Monitor CloudWatch metrics for throttling
- Set up alarms for capacity thresholds

## Monitoring and Operational Readiness

### CloudWatch Metrics to Monitor

**Base Table Metrics:**

- `ConsumedReadCapacityUnits` - Track read usage vs provisioned
- `ConsumedWriteCapacityUnits` - Track write usage vs provisioned
- `UserErrors` - Throttling events (target: 0)
- `SystemErrors` - DynamoDB service errors (target: 0)
- `SuccessfulRequestLatency` - Query performance (target: p99 < 50ms)

**GSI-Specific Metrics:**

- `OnlineIndexConsumedWriteCapacity` - GSI write usage per index
- `OnlineIndexThrottleEvents` - GSI throttling (CRITICAL - causes base table throttling)
- `OnlineIndexPercentageProgress` - GSI backfill progress (when adding new GSI)

**Hot Partition Metrics:**

- `AccountMaxReads` - Partition-level read throttling
- `AccountMaxWrites` - Partition-level write throttling
- Monitor for uneven distribution across partitions

### CloudWatch Alarms (Required)

**Critical Alarms:**

1. **GSI Throttling Alarm**
   - Metric: `UserErrors` on GSI
   - Threshold: > 0 for 2 consecutive periods
   - Action: Page on-call engineer immediately
   - Why: GSI throttling blocks all base table writes

2. **Base Table Throttling Alarm**
   - Metric: `UserErrors` on base table
   - Threshold: > 10 for 5 consecutive periods
   - Action: Alert operations team
   - Why: Indicates capacity issues or hot partitions

3. **High Latency Alarm**
   - Metric: `SuccessfulRequestLatency` p99
   - Threshold: > 100ms for 5 consecutive periods
   - Action: Alert operations team
   - Why: Indicates performance degradation

**Warning Alarms:**

1. **Capacity Utilization Alarm**
   - Metric: `ConsumedWriteCapacityUnits`
   - Threshold: > 80% of provisioned for 10 minutes
   - Action: Notify operations team
   - Why: Approaching capacity limits

2. **Error Rate Alarm**
   - Metric: `UserErrors` + `SystemErrors`
   - Threshold: > 1% of requests for 5 minutes
   - Action: Notify operations team
   - Why: Indicates issues requiring investigation

### Operational Runbook

**Common Tasks:**

1. **Scaling Capacity**
   - When: Capacity utilization > 80% sustained
   - How: Update provisioned capacity or switch to on-demand
   - Validation: Monitor throttling metrics for 1 hour

2. **Adding New GSI**
   - When: New access pattern identified
   - How: Create GSI during low-traffic period
   - Validation: Monitor `OnlineIndexPercentageProgress` until 100%
   - Caution: Provision extra write capacity during backfill

3. **Investigating Throttling**
   - Check: GSI throttling first (most common cause)
   - Check: Hot partition metrics
   - Check: Capacity utilization vs provisioned
   - Action: Increase capacity or implement write sharding

4. **Handling Hot Partitions**
   - Identify: CloudWatch partition-level metrics
   - Analyze: Query patterns for skewed access
   - Mitigate: Write sharding, caching, or partition key redesign

**Troubleshooting Guide:**

| Symptom                 | Likely Cause              | Investigation Steps                   | Resolution                                 |
| ----------------------- | ------------------------- | ------------------------------------- | ------------------------------------------ |
| All writes failing      | GSI throttling            | Check GSI `UserErrors` metric         | Increase GSI write capacity                |
| Specific queries slow   | Hot partition             | Check partition-level metrics         | Implement write sharding or caching        |
| Intermittent throttling | Burst capacity exhausted  | Check capacity utilization trends     | Increase provisioned capacity              |
| New GSI not working     | Backfill in progress      | Check `OnlineIndexPercentageProgress` | Wait for backfill completion               |
| High costs              | Over-provisioned capacity | Review capacity utilization           | Right-size capacity or switch to on-demand |

## Performance Validation Plan

**CRITICAL:** All performance estimates in this document must be validated before production deployment. This section defines required validation procedures.

### Performance Baseline Requirements

Before declaring design production-ready, validate these metrics:

| Metric                | Target (Estimated) | Measurement Method                       | Success Criteria        |
| --------------------- | ------------------ | ---------------------------------------- | ----------------------- |
| GetItem latency (p99) | <10ms              | Load testing + CloudWatch                | Actual p99 ≤ target     |
| Query latency (p99)   | <50-100ms          | Load testing + CloudWatch                | Actual p99 ≤ target     |
| Scan latency (p99)    | <500ms             | Load testing + CloudWatch                | Actual p99 ≤ target     |
| Throttling rate       | 0%                 | CloudWatch `UserErrors`                  | < 0.1% of requests      |
| Error rate            | <0.1%              | CloudWatch `UserErrors` + `SystemErrors` | < 0.1% of requests      |
| Capacity utilization  | 60-80%             | CloudWatch consumed vs provisioned       | Within target range     |
| Cost per 1M requests  | $[estimated]       | AWS Cost Explorer                        | Within ±30% of estimate |

### Load Testing Requirements

**Minimum Testing Scenarios:**

1. **Steady State Test**
   - Duration: 30 minutes
   - Load: 100% of estimated peak traffic
   - Success: No throttling, latency within targets

2. **Burst Test**
   - Duration: 5 minutes
   - Load: 200% of estimated peak traffic
   - Success: < 10 throttling events, latency recovers within 1 minute

3. **Soak Test**
   - Duration: 4 hours
   - Load: 80% of estimated peak traffic
   - Success: No memory leaks, stable latency, no capacity drift

4. **Partition Distribution Test**
   - Duration: 15 minutes
   - Load: 100% of estimated peak traffic
   - Success: Even distribution across partitions (< 20% variance)

### Measurement Implementation

**Required CloudWatch Metrics:**

```javascript
// Add to all Lambda functions
const AWS = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch();

async function recordMetrics(operation, latency, itemSize) {
  await cloudwatch
    .putMetricData({
      Namespace: 'TaskFlow/DynamoDB',
      MetricData: [
        {
          MetricName: 'OperationLatency',
          Value: latency,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Operation', Value: operation },
            { Name: 'Table', Value: 'Tasks' },
          ],
        },
        {
          MetricName: 'ItemSize',
          Value: itemSize,
          Unit: 'Bytes',
          Dimensions: [{ Name: 'Operation', Value: operation }],
        },
      ],
    })
    .promise();
}

// Usage in Lambda
const startTime = Date.now();
const result = await docClient.send(command);
const latency = Date.now() - startTime;
const itemSize = JSON.stringify(result.Item).length;

await recordMetrics('GetItem', latency, itemSize);
```

**Required Alarms:**

1. **Performance Degradation Alarm**
   - Metric: Custom `OperationLatency` p99
   - Threshold: > 2× estimated latency for 5 minutes
   - Action: Alert operations team

2. **Estimate Validation Alarm**
   - Metric: Custom `OperationLatency` p99
   - Threshold: > 1.5× estimated latency for 15 minutes
   - Action: Review and update capacity estimates

### Validation Timeline

**Week 1: Initial Deployment**

- Deploy with 2× estimated capacity (safety margin)
- Run load tests daily
- Monitor actual vs estimated performance
- Document discrepancies

**Week 2-4: Calibration**

- Adjust capacity based on actual metrics
- Re-run load tests after adjustments
- Update performance estimates with actual data
- Identify optimization opportunities

**Month 2+: Continuous Validation**

- Monthly performance reviews
- Quarterly load testing
- Update estimates based on growth trends
- Validate new access patterns

## Testing Recommendations

### Load Testing

1. **Partition Key Distribution Test**
   - Generate realistic data with production-like key distribution
   - Verify no hot partitions using CloudWatch metrics
   - Monitor `ConsumedReadCapacityUnits` and `ConsumedWriteCapacityUnits` per partition
   - Target: Even distribution within 20% variance

2. **Access Pattern Validation**
   - Test each access pattern with realistic query volumes
   - Measure query latency (target: p99 < 10ms for GetItem, < 50ms for Query)
   - Verify GSI queries return expected results
   - Test pagination for large result sets

3. **Capacity Testing**
   - Load test at 2× expected peak traffic
   - Verify no throttling occurs
   - Test burst capacity handling
   - Monitor adaptive capacity behavior

### Data Validation

1. **Schema Validation**
   - Verify all required attributes are present
   - Test attribute type constraints
   - Validate data size limits (item < 400KB)
   - Test conditional writes and optimistic locking

2. **Index Coverage**
   - Verify all access patterns can be satisfied
   - Confirm no table scans in production queries
   - Test sparse index behavior
   - Validate projected attributes are sufficient

### Operational Testing

1. **Backup and Recovery**
   - Test PITR restore process
   - Verify on-demand backup creation
   - Test cross-region restore (if applicable)
   - Document recovery time objectives (RTO)

2. **Monitoring Setup**
   - Configure CloudWatch alarms for throttling
   - Set up alarms for hot partition warnings
   - Monitor GSI capacity consumption
   - Track error rates and latency metrics

3. **Security Validation**
   - Verify encryption at rest is enabled
   - Test IAM policies for least privilege access
   - Validate VPC endpoint configuration (if applicable)
   - Test audit logging with CloudTrail
