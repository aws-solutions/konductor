# Expert design validation and quality gates

Read this when running Step 5 or the quality gate.

## Expert Design Validation and Quality Gates

Before finalizing any DynamoDB design, perform these validation checks to ensure production-ready quality:

### Design Quality Checklist

**Partition Key Quality:**

- [ ] High cardinality validated (estimate unique values documented)
- [ ] Distribution analysis performed (no 80/20 skew expected)
- [ ] Hot partition risk assessed and mitigated
- [ ] Composite key considered if single attribute insufficient
- [ ] Write sharding strategy documented if needed

**Sort Key Quality:**

- [ ] Range query patterns documented
- [ ] Composite key pattern justified
- [ ] Hierarchical data structure validated
- [ ] begins_with query patterns tested
- [ ] Multi-purpose design evaluated

**Index Quality:**

- [ ] Each index justified with access pattern frequency
- [ ] GSI partition key cardinality validated (> 1000 unique values)
- [ ] LSI 10GB limit validated with growth projections
- [ ] Projection type optimized (not defaulting to ALL)
- [ ] Index count minimized (≤ 5 GSIs, ≤ 3 LSIs)
- [ ] Sparse index opportunities identified
- [ ] Index overloading considered

**Capacity Quality:**

- [ ] RCU/WCU calculations documented with formulas
- [ ] GSI capacity ≥ base table write capacity
- [ ] Growth projections included (6 months, 12 months)
- [ ] Billing mode justified (on-demand vs provisioned)
- [ ] Cost analysis includes all indexes
- [ ] Burst capacity not relied upon for sustained traffic

**Operational Quality:**

- [ ] Monitoring strategy defined (CloudWatch metrics, alarms)
- [ ] Backup strategy documented (PITR, on-demand, retention)
- [ ] Security configuration complete (encryption, IAM, VPC)
- [ ] Disaster recovery plan documented (RTO, RPO)
- [ ] Testing plan includes load testing and partition distribution
- [ ] Runbook created for common operational tasks

**Code Quality:**

- [ ] CDK/CloudFormation code includes all security settings
- [ ] Example queries provided for all access patterns
- [ ] Error handling implemented (throttling, conditional checks)
- [ ] Idempotency patterns documented
- [ ] Retry logic with exponential backoff included

### Common Design Smells (Red Flags)

If any of these are present, reconsider the design:

**Partition Key Smells:**

- Partition key is timestamp or date (all writes go to current time)
- Partition key is status, type, or category (low cardinality)
- Partition key is boolean flag (only 2 values)
- No cardinality analysis performed
- "It seemed like a good idea" justification

**Index Smells:**

- More than 5 GSIs on single table
- GSI partition key has < 100 unique values
- All indexes use ALL projection
- LSI on table with unbounded partition growth
- Index created "just in case we need it later"
- No cost analysis for index overhead

**Capacity Smells:**

- GSI capacity < base table write capacity
- No growth projections documented
- Relying on burst capacity for normal traffic
- No monitoring or alarms configured
- "We'll figure it out in production" approach

**Query Pattern Smells:**

- **CRITICAL:** Scan operations in production code (frequency > 1% of operations)
- **CRITICAL:** "List all items" access pattern without GSI (forces Scan)
- **CRITICAL:** Search/filter patterns that require Scan (add GSI instead)
- No access pattern frequency documented
- "We might need to query by X someday"
- Queries not tested with production-like data volume
- No pagination strategy for large result sets
- Using Query without Limit parameter for large result sets
- Not implementing exponential backoff for throttled requests
- Fetching all attributes when only subset needed

**Scan Operation Red Flags:**

- Any access pattern with frequency > 10/sec using Scan
- "List all" operations in user-facing features
- Search functionality relying on Scan with FilterExpression
- Combined filters requiring Scan (should use composite GSI keys)
- Pagination using Scan (should use Query with GSI)

### Production Readiness Gates

**Gate 1: Design Review (Before Implementation)**

- [ ] All access patterns documented with frequency
- [ ] Partition key cardinality validated
- [ ] Index strategy justified and validated
- [ ] Capacity calculations reviewed
- [ ] Cost analysis approved
- [ ] Security requirements met
- [ ] Peer review completed

**Gate 2: Implementation Review (Before Deployment)**

- [ ] Infrastructure code reviewed
- [ ] All security settings enabled
- [ ] Monitoring and alarms configured
- [ ] Backup strategy implemented
- [ ] Example queries tested
- [ ] Error handling validated
- [ ] Documentation complete

**Gate 3: Load Testing (Before Production)**

- [ ] Partition distribution validated (no hot partitions)
- [ ] Query latency meets requirements (p99 < 50ms)
- [ ] No throttling at 2× expected peak load
- [ ] GSI backfill tested (if applicable)
- [ ] Failure scenarios tested (throttling, timeouts)
- [ ] Monitoring validated (metrics, alarms)
- [ ] Runbook validated with test scenarios

**Gate 4: Production Validation (First 48 Hours)**

- [ ] CloudWatch metrics reviewed (no throttling)
- [ ] Partition distribution monitored (no hot partitions)
- [ ] Query latency within SLA (p99, p95, p50)
- [ ] Error rates acceptable (< 0.1%)
- [ ] Cost tracking enabled and reviewed
- [ ] No unexpected capacity consumption
- [ ] Team trained on monitoring and troubleshooting

### Design Review Questions

Ask these questions during design review to catch issues early:

**Access Pattern Questions:**

1. What are the top 3 most frequent queries? (Should drive partition key choice)
2. What's the read:write ratio? (Affects capacity planning)
3. **CRITICAL:** Are there any queries that will scan the table? (Red flag - must eliminate with GSI)
4. **CRITICAL:** Does "list all items" appear in requirements? (Add GSI to avoid Scan)
5. How will pagination work for large result sets?
6. What's the expected query latency requirement?
7. Are there any search/filter patterns that might require Scan? (Add GSI instead)

**Partition Key Questions:**

1. How many unique values will this partition key have? (Need thousands+)
2. Will writes be evenly distributed across partition keys? (Avoid hot partitions)
3. What happens if one partition key gets 10× more traffic? (Hot partition scenario)
4. How will this scale to 10× current data volume?
5. Is there any temporal pattern to writes? (Time-based keys are problematic)

**Index Questions:**

1. Why is this index needed? What query does it support?
2. How often will this query be executed? (Justify 2× write cost)
3. What's the cardinality of the GSI partition key? (Need high cardinality)
4. Why this projection type? (Challenge ALL projection)
5. Could this query be satisfied by existing index?
6. What happens if we don't have this index? (Alternative solutions)

**Capacity Questions:**

1. What's the expected peak traffic? (Size capacity appropriately)
2. Is traffic predictable or bursty? (On-demand vs provisioned)
3. What's the growth projection for next 12 months?
4. What's the monthly cost including all indexes?
5. Is GSI capacity ≥ base table write capacity? (Prevent throttling cascade)

**Operational Questions:**

1. How will we monitor table health? (Metrics, alarms, dashboards)
2. What's the backup and recovery strategy? (PITR, on-demand, cross-region)
3. How will we handle throttling in production? (Retry logic, capacity adjustment)
4. What's the disaster recovery plan? (RTO, RPO, runbook)
5. Who's on-call for DynamoDB issues? (Operational ownership)

### Expert Tips for Zero-Error Designs

**Tip 1: Start with Access Patterns, Not Data Model**

- Don't design tables based on entities (that's SQL thinking)
- List all queries first, then design table to support them
- Most frequent query determines partition key
- Range queries determine sort key
- Alternate queries determine GSI strategy

**Tip 2: Default to GSI, Rarely Use LSI**

- LSI is correct choice < 5% of the time
- Most applications don't need strongly consistent reads
- 10GB partition limit is easily exceeded
- GSI provides more flexibility and scalability
- Only use LSI if you have specific strong consistency requirement

**Tip 3: Minimize Index Count**

- Each GSI doubles write cost
- More indexes = more complexity, more monitoring, more cost
- Target: 0-3 GSIs per table (3-5 maximum)
- Use index overloading to consolidate indexes
- Question every index: "Is this query worth 2× write cost?"

**Tip 4: Provision GSI Capacity Generously**

- GSI throttling blocks base table writes
- Always provision GSI capacity ≥ base table write capacity
- Use on-demand mode if traffic unpredictable
- Monitor GSI throttling metrics religiously
- Better to over-provision than risk cascading failures

**Tip 5: Test with Production-Like Data Volume**

- Small data sets hide hot partition issues
- Load test with millions of items, not thousands
- Validate partition distribution with CloudWatch metrics
- Test at 2× expected peak traffic
- Identify issues before production deployment

**Tip 6: Design for Failure**

- Implement retry logic with exponential backoff
- Handle throttling gracefully (don't fail requests)
- Use conditional writes to prevent overwrites
- Implement idempotency for write operations
- Plan for GSI eventual consistency lag

**Tip 7: Monitor Everything**

- Set up CloudWatch alarms before production deployment
- Monitor: throttling, latency, error rates, capacity utilization
- Create dashboards for table and GSI health
- Alert on hot partition warnings
- Review metrics weekly, adjust capacity as needed
