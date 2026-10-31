# DynamoDB validation framework: the 13 categories

Read this when running the validation categories; each H3 is one category with what to check for and its numbered validation checks.

### CATEGORY 1: PARTITION KEY DESIGN (Critical Priority)

Check for:

- **Low cardinality**: Partition keys with < 100 unique values create hot partition risk
- **Uneven distribution**: Some partition key values accessed much more frequently than others
- **Missing write sharding**: High-traffic keys without sharding strategy (random suffix, calculated hash)
- **Inappropriate attribute choice**: Using status, type, category, or other low-cardinality attributes as partition keys
- **Temporal keys**: Using date/timestamp as partition key without sharding (creates sequential hot partitions)
- **Composite key opportunities**: Missing chances to combine attributes for better distribution

**Validation Checks**:

1. Count unique partition key values (warn if < 100, critical if < 10)
2. Analyze access pattern frequency distribution (flag if top 10% accounts for > 50% of traffic)
3. Identify low-cardinality attributes used as partition keys
4. Check for write sharding implementation on high-traffic keys
5. Verify partition key supports primary access pattern efficiently

### CATEGORY 2: INDEX COVERAGE (High Priority)

Check for:

- **Access patterns requiring table scans**: Queries not supported by primary key or any GSI/LSI
- **"List all items" without GSI**: Common anti-pattern forcing Scan operations in production
- **Missing GSI for alternate query patterns**: Common queries that could benefit from secondary indexes
- **Over-provisioned indexes**: GSIs projecting ALL attributes when only subset needed
- **Opportunities for sparse indexes**: Optional attributes that could use sparse index pattern
- **Index overloading missed**: Multiple entity types that could share same GSI
- **LSI opportunities**: Range queries within partition that could use LSI instead of GSI

**Validation Checks**:

1. Map each stated access pattern to primary key or index
2. **CRITICAL:** Identify patterns requiring Scan operations (flag as CRITICAL if frequency > 10/sec)
3. **CRITICAL:** Check for "list all items" or "get all records" patterns without GSI (recommend constant partition key GSI)
4. Calculate projected attribute usage vs actual query requirements
5. Detect sparse index opportunities (attributes present in < 50% of items)
6. Evaluate LSI vs GSI tradeoffs for range queries within partition
7. **NEW:** Validate that any Scan operations are justified (admin-only, < 100 items, background jobs)

### CATEGORY 3: DATA MODEL CONSISTENCY (High Priority)

Check for:

- **Inconsistent naming conventions**: Mixed camelCase, snake_case, PascalCase across attributes
- **Inappropriate attribute types**: Using String for numeric data, Number for boolean flags
- **Missing required attributes**: Attributes needed for access patterns not defined in schema
- **Relationship pattern inconsistencies**: Mixed embedded vs referenced patterns for similar relationships
- **Composite key format inconsistencies**: Different delimiter patterns (# vs | vs \_) across keys
- **Entity type identifiers**: Missing or inconsistent entity type prefixes in single-table designs

**Validation Checks**:

1. Verify naming convention consistency across all attributes
2. Validate attribute types match data semantics (numeric IDs as String, timestamps as Number)
3. Check all access patterns have required attributes defined
4. Identify relationship modeling inconsistencies
5. Validate composite key patterns follow consistent format

### CATEGORY 4: COST OPTIMIZATION (Medium Priority)

Check for:

- **Billing mode misalignment**: On-demand for predictable traffic, provisioned for unpredictable
- **Over-projected GSI attributes**: Projecting attributes never used in queries
- **Single table design benefits not realized**: Multiple tables that could be consolidated
- **Unused indexes**: GSIs defined but not used by any access pattern
- **Inefficient attribute sizes**: Large attribute values that could be normalized or compressed
- **Missing sparse index opportunities**: Indexes on optional attributes without sparse pattern

**Validation Checks**:

1. Analyze traffic patterns vs billing mode (steady = provisioned, spiky = on-demand)
2. Calculate storage overhead from over-projected GSI attributes
3. Identify consolidation opportunities for related tables
4. Detect unused indexes (no access patterns reference them)
5. Estimate potential savings from sparse indexes and attribute optimization

### CATEGORY 5: SECURITY & COMPLIANCE (Critical Priority)

Check for:

- **Missing encryption configuration**: Encryption at rest not enabled
- **Access control pattern issues**: Overly permissive IAM policies, missing fine-grained access control
- **Organizational standard violations**: Non-compliance with company-specific security requirements
- **Sensitive data in keys**: PII or sensitive data exposed in partition/sort keys
- **Missing VPC endpoint configuration**: Tables accessed over public internet
- **Audit logging gaps**: CloudTrail or DynamoDB Streams not configured for compliance

**Validation Checks**:

1. Verify encryption at rest enabled (AWS managed or customer managed KMS)
2. Review IAM policies for least privilege principle
3. Check for PII or sensitive data in partition/sort keys (logged in CloudWatch)
4. Validate VPC endpoint usage for private network access
5. Confirm audit logging meets organizational compliance requirements

### CATEGORY 6: BACKUP & DISASTER RECOVERY (High Priority)

Check for:

- **PITR not enabled**: Point-in-Time Recovery disabled for production tables
- **Missing backup strategy**: No documented backup retention or recovery procedures
- **No cross-region backup plan**: Critical data without cross-region restore capability
- **Backup retention period not specified**: Unclear how long backups retained
- **Missing RTO/RPO definitions**: Recovery objectives not documented
- **On-demand backup gaps**: No regular backup schedule for long-term retention

**Validation Checks**:

1. Verify PITR enabled for production tables (1-35 day retention)
2. Check for documented backup strategy with retention periods
3. Validate cross-region backup configuration for critical tables
4. Confirm RTO/RPO requirements documented and achievable
5. Review on-demand backup schedule for compliance requirements

### CATEGORY 7: ANTI-PATTERNS & USE CASE FIT (Critical Priority)

Check for:

- **DynamoDB for full-text search**: Should use OpenSearch or CloudSearch instead
- **DynamoDB for complex JOINs**: Multiple tables with complex relationships should use RDS/Aurora
- **DynamoDB for OLAP/analytics**: Aggregation-heavy workloads should use Redshift or Athena
- **Large binary files in DynamoDB**: Images, videos, documents should be in S3 with references
- **Ad-hoc query requirements**: Unknown query patterns should use RDS for flexibility
- **Strong consistency across regions**: Global tables are eventually consistent, use Aurora Global if needed
- **Frequently changing large items**: High write costs, consider normalization or alternative storage

**Validation Checks**:

1. Identify full-text search requirements (recommend OpenSearch)
2. Detect complex JOIN patterns across multiple tables (recommend RDS)
3. Flag aggregation and analytics workloads (recommend Redshift/Athena)
4. Check for large binary attributes > 10KB (recommend S3)
5. Validate use case aligns with DynamoDB strengths (key-value, document, simple queries)

### CATEGORY 8: GLOBAL TABLES & CROSS-REGION (Medium Priority)

Check for:

- **Global tables without conflict resolution strategy**: No documented approach for handling write conflicts
- **Cross-region replication without cost analysis**: Replication costs not estimated
- **Eventual consistency not considered**: Application logic assumes strong consistency across regions
- **Missing region failover procedures**: No documented failover process for regional outages
- **Inappropriate global table usage**: Single-region workload using global tables unnecessarily
- **Replication lag not monitored**: No CloudWatch alarms for replication delays

**Validation Checks**:

1. Verify conflict resolution strategy documented (last-writer-wins implications understood)
2. Calculate cross-region replication costs (storage + data transfer)
3. Confirm application handles eventual consistency correctly
4. Review region failover procedures and RTO/RPO targets
5. Validate global tables justified by multi-region requirements

### CATEGORY 9: STREAMS & EVENT-DRIVEN (Medium Priority)

Check for:

- **Streams not enabled when needed**: Event-driven architecture requirements without Streams
- **Incorrect stream view type**: Using KEYS_ONLY when NEW_IMAGE needed, or vice versa
- **Missing Lambda trigger configuration**: Streams enabled but no consumer configured
- **Stream processing without error handling**: No DLQ or retry logic for failed records
- **Stream retention not considered**: 24-hour retention may be insufficient for processing delays
- **Kinesis Data Streams alternative missed**: High-throughput scenarios better suited for Kinesis

**Validation Checks**:

1. Identify event-driven requirements and verify Streams enabled
2. Validate stream view type matches use case (audit = NEW_AND_OLD_IMAGES, replication = NEW_IMAGE)
3. Check Lambda trigger configuration with appropriate batch size and concurrency
4. Verify error handling with DLQ for failed records
5. Consider Kinesis Data Streams for > 1000 records/sec throughput

### CATEGORY 10: TRANSACTIONS & CONSISTENCY (High Priority)

Check for:

- **Multi-item operations without transactions**: ACID requirements not using TransactWriteItems/TransactGetItems
- **Inappropriate transaction usage**: Simple operations using transactions unnecessarily (2x cost)
- **Missing error handling for conflicts**: No retry logic for TransactionCanceledException
- **Transaction size exceeding limits**: > 100 items or > 4MB total size
- **GSI writes in transactions**: Transactions don't support GSI writes directly
- **Strongly consistent reads needed**: Eventually consistent reads insufficient for use case

**Validation Checks**:

1. Identify ACID requirements and verify transaction usage
2. Flag simple operations using transactions (recommend standard operations)
3. Validate error handling for transaction conflicts with exponential backoff
4. Check transaction size limits (100 items, 4MB)
5. Confirm strongly consistent reads used where required

### CATEGORY 11: CRITICAL PITFALLS DETECTION (Critical Priority)

Check for the 8 critical pitfalls that cause production issues:

**Pitfall 1: GSI Throttling Cascade**

- **Check**: GSI write capacity < base table write capacity
- **Detection**: Compare GSI provisioned WCU to base table WCU (or check on-demand mode)
- **Impact**: All writes to base table fail when GSI throttles, even if base table has capacity
- **Severity**: CRITICAL - Causes complete write outage
- **Evidence Required**: Show GSI capacity vs base table capacity with traffic estimates

**Pitfall 2: Low Cardinality GSI Partition Key**

- **Check**: GSI partition key has < 100 unique values
- **Detection**: Analyze GSI partition key attribute for cardinality
- **Impact**: Hot partitions cause throttling despite high provisioned capacity
- **Severity**: CRITICAL - Cannot scale regardless of capacity
- **Evidence Required**: Count unique values, show distribution analysis

**Pitfall 3: GSI Backfilling Delays**

- **Check**: Adding GSI to large existing table without backfill plan
- **Detection**: New GSI on table with > 1M items, no backfill strategy documented
- **Impact**: GSI unusable for hours/days, application cannot use new query pattern
- **Severity**: HIGH - Blocks feature deployment
- **Evidence Required**: Table size estimate, backfill time calculation, deployment plan

**Pitfall 4: Exceeding 10GB LSI Partition Limit**

- **Check**: LSI partition might exceed 10GB with growth projections
- **Detection**: Calculate current partition size + growth rate
- **Impact**: Writes fail when partition exceeds 10GB, cannot remove LSI after creation
- **Severity**: CRITICAL - Permanent data loss risk
- **Evidence Required**: Partition size calculation, growth projections, mitigation plan

**Pitfall 5: Over-Indexing**

- **Check**: > 5 GSIs or > 3 LSIs on single table
- **Detection**: Count total indexes
- **Impact**: Cost explosion (each GSI doubles write cost), operational complexity
- **Severity**: MEDIUM - Significant cost waste and maintenance burden
- **Evidence Required**: Index count, cost calculation, consolidation opportunities

**Pitfall 6: GSI Projection Mistakes**

- **Check**: ALL projection with unused attributes, or missing attributes requiring fetches
- **Detection**: Compare projected attributes to actual query requirements
- **Impact**: Wasted storage costs (ALL projection) or extra RCU costs (fetches)
- **Severity**: MEDIUM - 10-50% cost waste
- **Evidence Required**: Projection analysis, storage overhead calculation, fetch frequency

**Pitfall 7: Ignoring GSI Eventually Consistent Reads**

- **Check**: Application logic assumes immediate GSI consistency after write
- **Detection**: Code patterns showing write followed by immediate GSI query
- **Impact**: Race conditions, data inconsistency, failed queries
- **Severity**: HIGH - Data integrity issues
- **Evidence Required**: Code examples, consistency requirements, retry logic

**Pitfall 8: Not Monitoring GSI Health**

- **Check**: No CloudWatch alarms for GSI throttling or capacity
- **Detection**: Review monitoring configuration
- **Impact**: Silent failures, production incidents go undetected
- **Severity**: HIGH - Operational blindness
- **Evidence Required**: Alarm configuration (or lack thereof), monitoring gaps

**Validation Checks**:

1. For each GSI, verify write capacity >= base table write capacity
2. Calculate cardinality for all GSI partition keys (flag if < 100)
3. Identify new GSIs on large tables, check backfill planning
4. For each LSI, calculate partition size with 12-month growth projection
5. Count total indexes (flag if > 5 GSIs or > 3 LSIs)
6. Analyze GSI projections vs actual query requirements
7. Review application code for GSI consistency assumptions
8. Verify CloudWatch alarms configured for all GSI throttling metrics

### CATEGORY 12: DESIGN SMELL DETECTION (High Priority)

Systematically check for design anti-patterns that indicate poor design quality:

**Partition Key Smells**:

- **Timestamp/Date Partition Key**: Using date, timestamp, or time-based attribute as partition key without sharding

- Detection: Partition key attribute name contains "date", "time", "timestamp", "created", "updated"
- Impact: Sequential hot partitions, all writes go to current time period
- Severity: CRITICAL

- **Low-Cardinality Partition Key**: Using status, type, category, boolean, or enum as partition key

- Detection: Partition key has < 10 unique values
- Impact: Severe hot partitions, cannot scale
- Severity: CRITICAL

- **No Cardinality Analysis**: Partition key chosen without documented cardinality analysis

- Detection: No cardinality estimate or distribution analysis provided
- Impact: Unknown scalability risk
- Severity: HIGH

- **Inappropriate Attribute Choice**: Using attribute that doesn't align with primary access pattern

- Detection: Most frequent query doesn't use partition key
- Impact: Inefficient queries, table scans
- Severity: HIGH

- **Vague Justification**: Partition key choice justified with "seemed like a good idea" or similar
- Detection: No specific technical justification provided
- Impact: Indicates lack of design rigor
- Severity: MEDIUM

**Index Smells**:

- **Too Many Indexes**: > 5 GSIs on single table

- Detection: Count GSIs
- Impact: Cost explosion, operational complexity
- Severity: MEDIUM

- **Low-Cardinality GSI Partition Key**: GSI partition key has < 100 unique values

- Detection: Analyze GSI partition key cardinality
- Impact: Hot partitions in GSI
- Severity: CRITICAL

- **All Indexes Use ALL Projection**: Every GSI projects all attributes

- Detection: Check projection type for all GSIs
- Impact: 100% storage overhead per GSI
- Severity: MEDIUM

- **LSI on Unbounded Partition**: LSI on table where partitions might exceed 10GB

- Detection: Partition growth analysis
- Impact: Write failures when limit exceeded
- Severity: CRITICAL

- **Speculative Index**: Index created "just in case" without proven access pattern

- Detection: No documented access pattern using the index
- Impact: Wasted cost, no benefit
- Severity: MEDIUM

- **No Cost Analysis**: Indexes added without cost impact calculation
- Detection: No cost estimates provided
- Impact: Budget surprises
- Severity: LOW

**Capacity Smells**:

- **GSI Under-Provisioned**: GSI write capacity < base table write capacity

- Detection: Compare capacity settings
- Impact: GSI throttling blocks all writes
- Severity: CRITICAL

- **No Growth Projections**: Capacity set without 6-12 month growth analysis

- Detection: No growth projections documented
- Impact: Unexpected throttling as data grows
- Severity: HIGH

- **Relying on Burst Capacity**: Design assumes burst capacity for normal traffic

- Detection: Provisioned capacity < average traffic
- Impact: Throttling when burst exhausted
- Severity: HIGH

- **No Monitoring Plan**: No CloudWatch alarms or monitoring strategy
- Detection: No alarm configuration provided
- Impact: Blind to production issues
- Severity: HIGH

**Query Pattern Smells**:

- **Scan Operations in Production**: Access patterns require Scan operations

- Detection: Access pattern mapping shows Scan
- Impact: Poor performance, high cost at scale
- Severity: CRITICAL

- **"List All Items" Without GSI**: Common pattern forcing Scan in production UI

- Detection: Access pattern like "list all tasks", "get all users" without GSI
- Impact: Performance degrades linearly with table size, expensive at scale
- Severity: CRITICAL
- Recommendation: Add GSI with constant partition key (listKey="ALL") or type discriminator

- **No Access Pattern Frequency**: Access patterns listed without frequency estimates

- Detection: No req/sec or priority documented
- Impact: Cannot validate capacity planning
- Severity: HIGH

- **Speculative Access Patterns**: "We might need to query by X someday"

- Detection: Access patterns marked as "future" or "maybe"
- Impact: Over-engineering, wasted indexes
- Severity: MEDIUM

- **No Load Testing**: Queries not tested with production-like data volume

- Detection: No testing plan or results provided
- Impact: Unknown performance at scale
- Severity: HIGH

- **No Pagination Strategy**: Large result sets without pagination plan

- Detection: Queries returning > 1MB without Limit parameter
- Impact: Timeout errors, poor UX
- Severity: MEDIUM

- **No Limit Parameter**: Query operations without Limit parameter for large result sets

- Detection: Code examples show Query without Limit
- Impact: Excessive RCU consumption
- Severity: MEDIUM

- **No Retry Logic**: No exponential backoff for throttled requests

- Detection: Error handling doesn't include retry logic
- Impact: Failed requests instead of graceful degradation
- Severity: MEDIUM

- **Fetching Unused Attributes**: Queries fetch all attributes when only subset needed
- Detection: No ProjectionExpression in queries
- Impact: Wasted RCU, higher latency
- Severity: LOW

**Validation Checks**:

1. Scan partition key attribute name for temporal patterns
2. Calculate cardinality for partition key and all GSI partition keys
3. Verify cardinality analysis documented for all keys
4. Check access pattern frequency alignment with partition key
5. Review partition key justification for technical rigor
6. Count total GSIs and LSIs
7. Analyze all GSI partition keys for cardinality
8. Check projection types for all GSIs
9. Calculate LSI partition size with growth projections
10. Identify indexes without documented access patterns
11. Verify cost analysis provided for all indexes
12. Compare GSI capacity to base table capacity
13. Check for growth projections (6-12 months)
14. Verify provisioned capacity >= average traffic
15. Review monitoring and alarm configuration
16. Identify Scan operations in access patterns
17. Verify frequency estimates for all access patterns
18. Flag speculative or "future" access patterns
19. Check for load testing plan and results
20. Review pagination strategy for large result sets
21. Verify Limit parameter usage in queries
22. Check retry logic with exponential backoff
23. Review ProjectionExpression usage in queries

### CATEGORY 13: OPERATIONAL READINESS (High Priority)

Check for production monitoring and operational preparedness:

**Monitoring Configuration**:

- **CloudWatch Metrics**: Base table and GSI metrics configured
  - Required metrics: ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits, UserErrors, SystemErrors, SuccessfulRequestLatency
  - GSI metrics: OnlineIndexConsumedWriteCapacity, OnlineIndexThrottleEvents, OnlineIndexPercentageProgress
  - Hot partition metrics: AccountMaxReads, AccountMaxWrites
- **Required Alarms**: Critical alarms configured with appropriate thresholds
  - GSI throttling alarm (UserErrors on GSI > 0 for 2 periods) - CRITICAL
  - Base table throttling alarm (UserErrors > 10 for 5 periods) - HIGH
  - High latency alarm (SuccessfulRequestLatency p99 > 100ms for 5 periods) - HIGH
  - Capacity utilization alarm (ConsumedWriteCapacityUnits > 80% for 10 minutes) - WARNING
  - Error rate alarm (UserErrors + SystemErrors > 1% for 5 minutes) - WARNING
- **Dashboard**: Table health dashboard created
  - Throughput utilization graphs
  - Latency percentiles (p50, p95, p99)
  - Error rates and throttling events
  - GSI health metrics
- **Hot Partition Monitoring**: Partition-level metrics enabled and monitored

**Operational Procedures**:

- **Runbook**: Documented procedures for common operational tasks
  - Scaling capacity (when and how)
  - Adding new GSI (backfill planning, capacity provisioning)
  - Investigating throttling (GSI vs base table, hot partitions)
  - Handling hot partitions (write sharding, caching, redesign)
- **Troubleshooting Guide**: Common issues with investigation steps and resolutions
  - All writes failing → Check GSI throttling
  - Specific queries slow → Check for hot partitions
  - Intermittent throttling → Check burst capacity exhaustion
  - New GSI not working → Check backfill progress
  - High costs → Review capacity utilization and right-size
- **Escalation Procedures**: Clear escalation path for production issues
  - On-call rotation defined
  - Escalation criteria documented
  - Contact information current
- **Change Management**: Process for making table changes safely
  - Testing requirements before production changes
  - Rollback procedures documented
  - Communication plan for changes

**Performance Baselines**:

- **Load Testing**: Completed with production-like data volume and traffic
  - Partition distribution validated (no hot partitions)
  - Query latency benchmarked (p99 < 50ms target)
  - No throttling at 2× expected peak load
  - GSI backfill tested (if applicable)
- **Capacity Planning**: Growth projections and scaling strategy documented
  - Current traffic: [X] reads/sec, [Y] writes/sec
  - 6-month projection: [X] reads/sec, [Y] writes/sec
  - 12-month projection: [X] reads/sec, [Y] writes/sec
  - Scaling triggers and procedures
- **Performance SLAs**: Latency and availability targets defined
  - p99 latency target: [X] ms
  - p95 latency target: [Y] ms
  - Availability target: [Z]%
  - Error rate target: < [W]%

**Incident Response**:

- **Rollback Procedures**: Documented steps to revert changes
  - Infrastructure rollback (CloudFormation/CDK)
  - Application rollback (code deployment)
  - Data rollback (PITR restore)
- **Data Recovery**: Procedures tested and validated
  - PITR restore tested
  - On-demand backup restore tested
  - Cross-region restore tested (if applicable)
  - RTO/RPO targets validated
- **Failover Procedures**: Regional failover validated (if global tables)
  - Failover triggers defined
  - Failover steps documented
  - Failback procedures documented
  - Failover testing completed
- **Communication Plan**: Stakeholder communication during incidents
  - Status page updates
  - Internal notifications
  - Customer communications
  - Post-incident reviews

**Validation Checks**:

1. Verify all required CloudWatch metrics configured
2. Check all required alarms exist with appropriate thresholds
3. Validate dashboard includes all key metrics
4. Confirm hot partition monitoring enabled
5. Review runbook for completeness and accuracy
6. Validate troubleshooting guide covers common scenarios
7. Check escalation procedures are current
8. Verify change management process documented
9. Confirm load testing completed with results
10. Review capacity planning with growth projections
11. Validate performance SLAs defined and measurable
12. Check rollback procedures documented and tested
13. Verify data recovery procedures tested
14. Validate failover procedures (if applicable)
15. Review communication plan for completeness
