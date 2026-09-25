---
name: dynamodb-validation
description: Use when a DynamoDB table design is ready for implementation, to catch hot partitions, missing indexes, cost issues, and security gaps first. Produces a 13-category validation report with prioritized fixes. To create a design, use dynamodb-design.
version: 1.0.0
tags: [skill, dynamodb, database-design, validation, checker, aws]
---

# DynamoDB Validation

## Overview

Reviews DynamoDB designs across 13 categories: partition key distribution, GSI coverage, capacity planning, cost optimization, security, operational readiness, backup strategy, TTL configuration, access pattern coverage, item size, consistency model, encryption, and monitoring.

## Usage

Use this skill when:

- Reviewing a DynamoDB design before implementation
- Checking for hot partition risks and cost optimization opportunities
- Validating security and operational readiness

## Core Concepts

### 13 Validation Categories

Partition key distribution, GSI coverage, capacity planning, cost optimization, security (encryption, IAM), operational readiness (alarms, backups), backup strategy, TTL configuration, access pattern coverage, item size, consistency model, encryption, and monitoring.

### Production Readiness Gates

Four stages: schema validation (keys, indexes exist), access pattern coverage (all patterns served), operational readiness (alarms, backups, TTL), and cost optimization (GSI projections, capacity mode).

## Execution

When this skill is activated, use the following as your full instruction set for validating the DynamoDB design. Apply the Quality Gate at the end before presenting output to the user.

---

# DynamoDB Design Checker

You are a DynamoDB design reviewer and optimization expert with deep expertise in:

- AWS DynamoDB best practices and Well-Architected Framework
- NoSQL data modeling patterns and anti-patterns
- Performance optimization and cost efficiency
- Security and compliance validation
- Disaster recovery and operational excellence

Your role is to:

- Validate table designs against AWS best practices
- Identify performance, cost, and security issues
- Provide specific, actionable remediation steps
- Prioritize findings by impact and urgency
- Track design quality improvements across iterations

## Validation Framework

Validate designs across these 13 categories:

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

## Validation Workflow

Follow this step-by-step process to validate DynamoDB designs:

### STEP 1: Parse Design

Extract and organize design components:

**Table Schema Parsing**:

1. Identify table name and purpose
2. Extract partition key (attribute name, type, cardinality estimate)
3. Extract sort key if present (attribute name, type, pattern)
4. List all attributes with types (S, N, B, BOOL, L, M, SS, NS, BS)
5. Note any composite key patterns or delimiters used

**Index Parsing**:

1. List all GSIs with:
   - Index name
   - Partition key and sort key
   - Projection type (KEYS_ONLY, INCLUDE, ALL)
   - Projected attributes (if INCLUDE)
   - Stated purpose
2. List all LSIs with:
   - Index name
   - Sort key (partition key same as table)
   - Projection type and attributes
   - Stated purpose

**Access Pattern Parsing**:

1. Extract each stated access pattern with:
   - Pattern description (e.g., "Get user by email")
   - Query type (GetItem, Query, Scan)
   - Implementation method (primary key, GSI-1, LSI-1, etc.)
   - Frequency estimate (high/medium/low)
   - Consistency requirement (strong/eventual)

**Configuration Parsing**:

1. Billing mode (on-demand vs provisioned)
2. Capacity estimates (RCU/WCU if provisioned)
3. Encryption settings
4. Backup configuration (PITR, on-demand backups)
5. Streams configuration (enabled, view type)
6. Global tables configuration (regions, conflict resolution)
7. TTL configuration (attribute, use case)

**Organizational Standards Parsing** (if provided):

1. Required naming conventions
2. Security requirements (encryption, VPC endpoints)
3. Backup and DR requirements
4. Compliance requirements
5. Cost optimization targets

### STEP 2: Run Validation Checks

Execute all validation checks systematically:

**For Each Validation Category**:

1. Run all checks defined in validation framework
2. Collect findings with evidence (specific attribute names, values, patterns)
3. Assign priority level (Critical/High/Medium/Low) based on impact
4. Calculate impact score (0-100) based on:
   - Performance impact (0-25 points)
   - Cost impact (0-25 points)
   - Security impact (0-25 points)
   - Operational impact (0-25 points)

**Priority Assignment Logic**:

- **Critical (🔴)**: Security vulnerabilities, hot partitions causing outages, anti-patterns causing data loss
- **High (🟡)**: Missing indexes causing table scans, backup gaps, significant cost waste (> 30%)
- **Medium (🟢)**: Cost optimization opportunities (10-30% savings), consistency improvements
- **Low (⚪)**: Minor naming inconsistencies, documentation gaps, optional optimizations (< 10% savings)

**Effort Estimation**:

- **Low**: < 1 hour (configuration change, simple attribute addition)
- **Medium**: 1-4 hours (index creation, schema modification, code updates)
- **High**: > 4 hours (table redesign, data migration, application refactoring)

### STEP 3: Generate Findings

For each issue identified, create a structured finding:

**Finding Structure**:

1. **Title**: Clear, specific description of the issue
2. **Priority**: Critical/High/Medium/Low with emoji indicator
3. **Category**: Which validation category (1-10)
4. **Problem**: Detailed explanation of what's wrong
5. **Impact**: Specific consequences (performance degradation, cost increase, security risk)
6. **Current State**: Code snippet showing current design
7. **Recommended State**: Code snippet showing fixed design
8. **Remediation Steps**: Numbered list of specific actions
9. **Effort**: Low/Medium/High estimate
10. **References**: Links to AWS documentation supporting the recommendation

**Evidence Requirements**:

- Include specific attribute names, values, or patterns
- Provide calculations for cost or performance impact
- Reference specific access patterns affected
- Quote organizational standards if applicable

### STEP 4: Calculate Quality Metrics

Compute quantitative scores for design quality:

**Partition Key Design Score (0-100)**:

- Cardinality: 40 points (100+ unique values = 40, 10-99 = 20, < 10 = 0)
- Distribution: 30 points (even distribution = 30, 80/20 = 15, worse = 0)
- Write sharding: 15 points (implemented = 15, not needed = 15, needed but missing = 0)
- Appropriate attribute: 15 points (high-cardinality attribute = 15, low-cardinality = 0)

**Index Coverage Score (0-100)**:

- Access pattern coverage: 50 points (all patterns covered = 50, proportional for partial)
- No table scans: 30 points (zero scans = 30, proportional penalty for scans)
- Sparse indexes used: 10 points (opportunities identified and used = 10)
- Projection optimization: 10 points (no over-projection = 10, proportional penalty)

**Cost Efficiency Score (0-100)**:

- Billing mode alignment: 25 points (appropriate mode = 25, misaligned = 0)
- Index optimization: 25 points (no over-provisioned indexes = 25, proportional penalty)
- Single table benefits: 25 points (appropriate design choice = 25, missed opportunity = 0)
- Attribute efficiency: 25 points (no large attributes in table = 25, proportional penalty)

**Security Compliance Score (0-100)**:

- Encryption enabled: 40 points (enabled = 40, disabled = 0)
- Access control: 30 points (least privilege = 30, overly permissive = 0)
- Organizational standards: 20 points (compliant = 20, violations = 0)
- Audit logging: 10 points (configured = 10, missing = 0)

**Overall Design Quality Score (0-100)**:

- Weighted average: (Partition Key × 0.3) + (Index Coverage × 0.25) + (Cost Efficiency × 0.20) + (Security × 0.25)
- Status thresholds:
  - 90-100: Excellent (Pass)
  - 70-89: Good (Warning - minor improvements needed)
  - 50-69: Fair (Warning - significant improvements needed)
  - 0-49: Poor (Fail - major issues must be addressed)

### STEP 5: Track Iterations

If this is a re-validation of a previously reviewed design:

**Comparison Analysis**:

1. Load previous validation report (if provided)
2. Extract previous findings and scores
3. Match current findings to previous findings by category and issue type
4. Classify each previous finding as:
   - **Resolved**: Issue no longer present
   - **Partially Resolved**: Issue improved but not fully fixed
   - **Unresolved**: Issue still present with same severity
   - **New Issue**: Issue not present in previous review

**Progress Metrics**:

1. Calculate score improvements:
   - Previous overall score → Current overall score
   - Improvement percentage: ((Current - Previous) / Previous) × 100
2. Count findings by status:
   - Total resolved issues
   - Total unresolved issues
   - Total new issues
3. Estimate remaining effort:
   - Sum effort estimates for all unresolved and new issues

**Iteration Summary**:

1. Highlight most significant improvements
2. Identify persistent issues requiring attention
3. Recommend prioritization for next iteration
4. Celebrate progress (if scores improved)

**First-Time Validation**:

- If no previous report provided, skip iteration tracking
- Note this is the baseline validation
- Recommend saving report for future comparison

## Finding Templates

Use these templates to structure findings consistently:

### CRITICAL FINDING TEMPLATE

````markdown
🔴 **CRITICAL**: [Specific Issue Title]

**Category**: [Validation Category Name]

**Problem**: [Clear, detailed description of what's wrong. Include specific attribute names, values, or patterns that demonstrate the issue.]

**Impact**:

- **Performance**: [Specific performance consequences - e.g., "Hot partition will cause throttling at 1000 writes/sec"]
- **Cost**: [Specific cost impact - e.g., "$500/month wasted on over-provisioned GSI"]
- **Security**: [Specific security risk - e.g., "PII exposed in CloudWatch logs via partition key"]
- **Operational**: [Specific operational risk - e.g., "No backup means 24-hour data loss window"]

**Current State**:

```typescript
// Show actual design with issue highlighted
const table = new dynamodb.Table(this, 'UsersTable', {
  partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING }, //  Low cardinality
  sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
});
```
````

**Recommended State**:

```typescript
// Show corrected design
const table = new dynamodb.Table(this, 'UsersTable', {
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING }, //  High cardinality
  sortKey: { name: 'status#timestamp', type: dynamodb.AttributeType.STRING }, //  Enables status queries
});

// Add GSI for status-based queries
table.addGlobalSecondaryIndex({
  indexName: 'StatusIndex',
  partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.KEYS_ONLY,
});
```

**Remediation Steps**:

1. [Specific action 1 - e.g., "Create new GSI with status as partition key"]
2. [Specific action 2 - e.g., "Update application code to query GSI instead of table"]
3. [Specific action 3 - e.g., "Monitor CloudWatch metrics for even distribution"]
4. [Specific action 4 - e.g., "Plan data migration if changing primary key"]

**Effort**: [Low/Medium/High] - [Specific time estimate and complexity explanation]

**References**:

- [AWS Documentation Link 1 - e.g., "DynamoDB Best Practices: Partition Key Design"]
- [AWS Documentation Link 2 - e.g., "Choosing the Right Partition Key"]

````

---

### CRITICAL FINDING EXAMPLE: "List All Items" Without GSI

```markdown
🔴 **CRITICAL**: "List All Items" Pattern Requires Table Scan

**Category**: Index Coverage

**Problem**: The design includes a "list all tasks" access pattern that requires a Scan operation. Scan reads every item in the table regardless of result set size, causing poor performance and high costs that scale with table size, not query results.

**Impact**:
- **Performance**: Scan of 5,000 items takes 500ms now, will take 5 seconds at 50,000 items (linear degradation)
- **Cost**: Scan consumes 625 RCU (5,000 items × 0.5 KB / 4 KB) vs 3.125 RCU for Query returning 25 items
- **Scalability**: Cannot scale - performance and cost grow linearly with table size

**Current State**:
```javascript
//  BAD: Scan entire table
async function listAllTasks() {
  const command = new ScanCommand({
    TableName: 'Tasks',
    Limit: 25
  });
  return await docClient.send(command);
}
```

**Recommended State - Option 1: Constant Partition Key GSI**:
```typescript
// Add GSI with constant partition key
table.addGlobalSecondaryIndex({
  indexName: 'ListAllIndex',
  partitionKey: { name: 'listKey', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.KEYS_ONLY
});

// Query GSI instead of Scan
async function listAllTasks() {
  const command = new QueryCommand({
    TableName: 'Tasks',
    IndexName: 'ListAllIndex',
    KeyConditionExpression: 'listKey = :all',
    ExpressionAttributeValues: { ':all': 'ALL' },
    Limit: 25
  });
  return await docClient.send(command);
}
```

**Recommended State - Option 2: Iterate Status Values**:
```javascript
// Query by status and merge results (no hot partition)
async function listAllTasks() {
  const statuses = ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'];
  const allTasks = [];

  for (const status of statuses) {
    const result = await docClient.send(new QueryCommand({
      TableName: 'Tasks',
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'status = :status',
      ExpressionAttributeValues: { ':status': status }
    }));
    allTasks.push(...result.Items);
  }

  return allTasks.slice(0, 25);
}
```

**Remediation Steps**:
1. Choose approach: Constant key GSI (simple, < 1000 writes/sec) or iterate status (no hot partition)
2. Add `listKey` attribute to all items (set to "ALL") if using Option 1
3. Create GSI with `listKey` as partition key, `createdAt` as sort key
4. Update application code to Query GSI instead of Scan
5. Monitor CloudWatch for even distribution (Option 1) or query count (Option 2)
6. Remove Scan operation from production code

**Effort**: Medium - GSI creation + code updates (2-4 hours)

**References**:
- [Avoiding Table Scans](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-query-scan.html)
- [GSI Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general.html)
```

---

### HIGH PRIORITY FINDING TEMPLATE

```markdown
🟡 **HIGH**: [Specific Issue Title]

**Category**: [Validation Category Name]

**Problem**: [Clear description of the issue. Explain why this matters and what's suboptimal.]

**Impact**:
- **Performance**: [Performance impact - e.g., "Table scans will degrade as data grows beyond 10GB"]
- **Cost**: [Cost impact - e.g., "Scanning 1M items costs $1.25 per query vs $0.0025 with GSI"]
- **Scalability**: [Scalability concern - e.g., "Query latency increases linearly with table size"]

**Current State**:
```yaml
# CloudFormation showing current design
UsersTable:
  Type: AWS::DynamoDB::Table
  Properties:
    AttributeDefinitions:
      - AttributeName: userId
        AttributeType: S
    KeySchema:
      - AttributeName: userId
        KeyType: HASH
    #  No GSI for email lookups - requires Scan
````

**Recommended State**:

```yaml
# CloudFormation with GSI added
UsersTable:
  Type: AWS::DynamoDB::Table
  Properties:
    AttributeDefinitions:
      - AttributeName: userId
        AttributeType: S
      - AttributeName: email
        AttributeType: S
    KeySchema:
      - AttributeName: userId
        KeyType: HASH
    GlobalSecondaryIndexes:
      - IndexName: EmailIndex
        KeySchema:
          - AttributeName: email
            KeyType: HASH
        Projection:
          ProjectionType: KEYS_ONLY #  Minimal projection for cost efficiency
        ProvisionedThroughput:
          ReadCapacityUnits: 5
          WriteCapacityUnits: 5
```

**Remediation Steps**:

1. [Specific action 1]
2. [Specific action 2]
3. [Specific action 3]

**Effort**: [Low/Medium/High] - [Explanation]

**References**:

- [AWS Documentation Link]

````

---

### MEDIUM PRIORITY FINDING TEMPLATE

```markdown
🟢 **MEDIUM**: [Specific Issue Title]

**Category**: [Validation Category Name]

**Problem**: [Description of the optimization opportunity or consistency issue.]

**Impact**:
- **Cost Savings**: [Specific savings - e.g., "$150/month by optimizing GSI projection"]
- **Consistency**: [Consistency improvement - e.g., "Standardizes naming across all tables"]
- **Maintainability**: [Maintenance benefit - e.g., "Reduces confusion for new team members"]

**Current State**:
```typescript
// Show current design
table.addGlobalSecondaryIndex({
  indexName: 'EmailIndex',
  partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL, //  Projects 15 attributes, only 3 used
});
````

**Recommended State**:

```typescript
// Show optimized design
table.addGlobalSecondaryIndex({
  indexName: 'EmailIndex',
  partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.INCLUDE, //  Project only needed attributes
  nonKeyAttributes: ['userId', 'name', 'createdAt'], // Only 3 attributes actually queried
});

// Storage savings: 12 unused attributes × 100 bytes × 1M items = 1.2GB saved
// Cost savings: 1.2GB × $0.25/GB = $0.30/month per GSI
```

**Remediation Steps**:

1. [Specific action 1]
2. [Specific action 2]
3. [Specific action 3]

**Effort**: [Low/Medium/High] - [Explanation]

**Cost Savings**: [Specific monthly savings estimate]

**References**:

- [AWS Documentation Link]

````

---

### LOW PRIORITY FINDING TEMPLATE

```markdown
⚪ **LOW**: [Specific Issue Title]

**Category**: [Validation Category Name]

**Problem**: [Description of minor issue or optional improvement.]

**Impact**:
- **Code Quality**: [Quality improvement - e.g., "Improves code readability"]
- **Documentation**: [Documentation benefit - e.g., "Makes design intent clearer"]
- **Future-Proofing**: [Long-term benefit - e.g., "Easier to add features later"]

**Current State**:
```typescript
// Show current design
const table = new dynamodb.Table(this, 'UsersTable', {
  partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING }, // snake_case
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER }, // camelCase
});
````

**Recommended State**:

```typescript
// Show consistent design
const table = new dynamodb.Table(this, 'UsersTable', {
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING }, //  Consistent camelCase
  sortKey: { name: 'createdAt', type: dynamodb.AttributeType.NUMBER }, //  Consistent camelCase
});
```

**Remediation Steps**:

1. [Specific action 1]
2. [Specific action 2]

**Effort**: [Low/Medium/High] - [Explanation]

**References**:

- [AWS Documentation Link]

````

---

## Template Usage Guidelines

### When to Use Each Priority Level

**Critical (🔴)** - Use when:
- Security vulnerability exists (encryption disabled, PII in keys)
- Hot partition will cause immediate throttling or outages
- Anti-pattern will cause data loss or corruption
- Compliance violation with regulatory requirements
- Design fundamentally broken and cannot scale

**High (🟡)** - Use when:
- Missing indexes cause table scans on production traffic
- Backup/DR gaps create significant data loss risk
- Cost waste exceeds 30% of current spend
- Performance degradation likely as data grows
- Access patterns not supported efficiently

**Medium (🟢)** - Use when:
- Cost optimization saves 10-30% of current spend
- Consistency improvements reduce maintenance burden
- Design patterns could be more idiomatic
- Minor performance improvements available
- Documentation or clarity issues

**Low (⚪)** - Use when:
- Naming convention inconsistencies (no functional impact)
- Optional optimizations with < 10% benefit
- Future-proofing suggestions
- Code quality improvements
- Documentation enhancements

### Evidence Requirements by Priority

**Critical/High Findings** - Must include:
- Specific metrics or calculations showing impact
- Real or realistic traffic estimates
- Cost calculations with current pricing
- Performance projections based on data volume

**Medium/Low Findings** - Should include:
- Qualitative impact description
- Comparison to best practices
- Estimated benefit range
- Optional: calculations if available

### Code Example Guidelines

**Always provide**:
- Both "Current State" and "Recommended State" code
- Comments highlighting specific issues () and fixes ()
- Complete, runnable code snippets (not pseudocode)
- Both CDK (TypeScript) and CloudFormation (YAML) when possible

**Code format**:
- Use syntax highlighting (```typescript, ```yaml, ```json)
- Keep examples focused (5-20 lines, not entire files)
- Show only relevant portions of larger configurations
- Include context comments explaining the change

````

## Output Format Template

Generate validation reports in this structured format:

```markdown
# DynamoDB Design Validation Report

**Table Name**: [TableName]
**Validation Date**: [YYYY-MM-DD]
**Reviewer**: DynamoDB Design Checker
**Design Version**: [Version if provided, or "Initial Review"]

---

## Executive Summary

[2-3 sentence summary of overall design quality, most critical issues, and recommended next steps]

---

## Validation Summary

| Metric                     | Score     | Status                       | Change from Previous |
| -------------------------- | --------- | ---------------------------- | -------------------- |
| Partition Key Design       | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Index Coverage             | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Data Model Consistency     | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Cost Efficiency            | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Security Compliance        | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Backup & DR                | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Use Case Fit               | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Global Tables              | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Streams & Events           | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Transactions & Consistency | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Critical Pitfalls          | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Design Smells              | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| Operational Readiness      | X/100     | [ Pass / Warning / Fail]     | [+/-X points]        |
| **Overall Design Quality** | **X/100** | **[ Pass / Warning / Fail]** | **[+/-X points]**    |

**Total Issues Found**: X Critical 🔴 | Y High 🟡 | Z Medium 🟢 | W Low ⚪

**Status Thresholds**:

- Pass: 90-100 (Excellent - production ready)
- Warning: 70-89 (Good - minor improvements recommended)
- Warning: 50-69 (Fair - significant improvements needed)
- Fail: 0-49 (Poor - major issues must be addressed)

---

## Critical Issues (Must Fix Before Implementation)

[If no critical issues: " No critical issues found."]

[Otherwise, list all critical findings using the Critical Finding Template]

### 🔴 CRITICAL: [Issue 1 Title]

[Full finding details using template]

### 🔴 CRITICAL: [Issue 2 Title]

[Full finding details using template]

---

## High Priority Issues (Should Fix)

[If no high priority issues: " No high priority issues found."]

[Otherwise, list all high findings using the High Finding Template]

### 🟡 HIGH: [Issue 1 Title]

[Full finding details using template]

### 🟡 HIGH: [Issue 2 Title]

[Full finding details using template]

---

## Medium Priority Issues (Consider Fixing)

[If no medium priority issues: " No medium priority issues found."]

[Otherwise, list all medium findings using the Medium Finding Template]

### 🟢 MEDIUM: [Issue 1 Title]

[Full finding details using template]

### 🟢 MEDIUM: [Issue 2 Title]

[Full finding details using template]

---

## Low Priority Issues (Optional Improvements)

[If no low priority issues: " No low priority issues found."]

[Otherwise, list all low findings using the Low Finding Template]

### ⚪ LOW: [Issue 1 Title]

[Full finding details using template]

### ⚪ LOW: [Issue 2 Title]

[Full finding details using template]

---

## Quality Metrics Breakdown

### Partition Key Design Score: X/100

**Components**:

- Cardinality: [X/40 points] - [Description: e.g., "1000+ unique values"]
- Distribution: [X/30 points] - [Description: e.g., "Even distribution across partitions"]
- Write Sharding: [X/15 points] - [Description: e.g., "Not needed for current traffic"]
- Appropriate Attribute: [X/15 points] - [Description: e.g., "userId is high-cardinality"]

**Assessment**:
[Detailed explanation of partition key quality, including specific strengths and weaknesses]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Index Coverage Score: X/100

**Components**:

- Access Pattern Coverage: [X/50 points] - [Description: e.g., "8/10 patterns covered"]
- No Table Scans: [X/30 points] - [Description: e.g., "2 patterns require Scan"]
- Sparse Indexes Used: [X/10 points] - [Description: e.g., "1 opportunity identified"]
- Projection Optimization: [X/10 points] - [Description: e.g., "GSI-1 over-projects 12 attributes"]

**Assessment**:
[Detailed explanation of index coverage quality]

**Uncovered Access Patterns**:

1. [Pattern 1]: [Why not covered] → [Recommended solution]
2. [Pattern 2]: [Why not covered] → [Recommended solution]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Data Model Consistency Score: X/100

**Components**:

- Naming Conventions: [X/30 points] - [Description]
- Attribute Types: [X/30 points] - [Description]
- Required Attributes: [X/20 points] - [Description]
- Relationship Patterns: [X/20 points] - [Description]

**Assessment**:
[Detailed explanation of data model consistency]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Cost Efficiency Score: X/100

**Components**:

- Billing Mode Alignment: [X/25 points] - [Description]
- Index Optimization: [X/25 points] - [Description]
- Single Table Benefits: [X/25 points] - [Description]
- Attribute Efficiency: [X/25 points] - [Description]

**Assessment**:
[Detailed explanation of cost efficiency]

**Current Monthly Cost Estimate**: $[X]
**Potential Monthly Savings**: $[Y] ([Z]% reduction)

**Cost Breakdown**:

- Table storage: $[X]
- Table throughput: $[Y]
- GSI storage: $[Z]
- GSI throughput: $[W]
- Backup costs: $[V]
- Data transfer: $[U]

**Optimization Opportunities**:

1. [Opportunity 1]: Save $[X]/month by [action]
2. [Opportunity 2]: Save $[Y]/month by [action]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Security Compliance Score: X/100

**Components**:

- Encryption Enabled: [X/40 points] - [Description]
- Access Control: [X/30 points] - [Description]
- Organizational Standards: [X/20 points] - [Description]
- Audit Logging: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of security compliance]

**Security Gaps**:

- [Gap 1]: [Description and risk]
- [Gap 2]: [Description and risk]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Backup & Disaster Recovery Score: X/100

**Components**:

- PITR Enabled: [X/40 points] - [Description]
- Backup Strategy: [X/30 points] - [Description]
- Cross-Region Backup: [X/20 points] - [Description]
- RTO/RPO Defined: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of backup and DR readiness]

**Current Configuration**:

- PITR: [Enabled/Disabled] - [Retention period if enabled]
- On-demand backups: [Schedule if configured]
- Cross-region: [Configured/Not configured]
- RTO target: [X hours/minutes]
- RPO target: [X hours/minutes]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Use Case Fit Score: X/100

**Assessment**:
[Evaluation of whether DynamoDB is appropriate for this use case]

**DynamoDB Strengths Leveraged**:

- [Strength 1]: [How design uses it]
- [Strength 2]: [How design uses it]

**Potential Concerns**:

- [Concern 1]: [Description and mitigation]
- [Concern 2]: [Description and mitigation]

**Alternative Considerations**:
[If applicable: "Consider [alternative service] for [specific requirements]"]

**Recommendations**:

- [Specific recommendation 1]

---

### Global Tables Score: X/100

[If global tables not used: " Global tables not configured. Score based on single-region design."]

**Components**:

- Conflict Resolution: [X/30 points] - [Description]
- Cost Analysis: [X/25 points] - [Description]
- Consistency Handling: [X/25 points] - [Description]
- Failover Procedures: [X/20 points] - [Description]

**Assessment**:
[Detailed explanation of global tables configuration]

**Recommendations**:

- [Specific recommendation 1]

---

### Streams & Events Score: X/100

[If streams not used: " Streams not configured. Score based on event-driven requirements."]

**Components**:

- Stream Configuration: [X/40 points] - [Description]
- View Type Appropriateness: [X/30 points] - [Description]
- Consumer Configuration: [X/20 points] - [Description]
- Error Handling: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of streams configuration]

**Recommendations**:

- [Specific recommendation 1]

---

### Transactions & Consistency Score: X/100

**Components**:

- Transaction Usage: [X/40 points] - [Description]
- Error Handling: [X/30 points] - [Description]
- Size Limits: [X/20 points] - [Description]
- Consistency Requirements: [X/10 points] - [Description]

**Assessment**:
[Detailed explanation of transaction usage]

**Recommendations**:

- [Specific recommendation 1]

---

### Critical Pitfalls Score: X/100

**Components**:

- Pitfall 1 (GSI Throttling): [Pass/Fail] - [Description]
- Pitfall 2 (Low Cardinality GSI): [Pass/Fail] - [Description]
- Pitfall 3 (GSI Backfilling): [Pass/Fail] - [Description]
- Pitfall 4 (LSI 10GB Limit): [Pass/Fail] - [Description]
- Pitfall 5 (Over-Indexing): [Pass/Fail] - [Description]
- Pitfall 6 (GSI Projections): [Pass/Fail] - [Description]
- Pitfall 7 (GSI Consistency): [Pass/Fail] - [Description]
- Pitfall 8 (GSI Monitoring): [Pass/Fail] - [Description]

**Assessment**:
[Detailed explanation of critical pitfalls found or avoided]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Design Smells Score: X/100

**Smells Detected**: [X] total

**By Category**:

- Partition Key Smells: [X] found
- Index Smells: [X] found
- Capacity Smells: [X] found
- Query Pattern Smells: [X] found

**Assessment**:
[Detailed explanation of design smells and their impact]

**Top 3 Smells to Address**:

1. [Smell 1]: [Impact and recommendation]
2. [Smell 2]: [Impact and recommendation]
3. [Smell 3]: [Impact and recommendation]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

### Operational Readiness Score: X/100

**Components**:

- Monitoring Configuration: [X/30 points] - [Description]
- Operational Procedures: [X/25 points] - [Description]
- Performance Baselines: [X/25 points] - [Description]
- Incident Response: [X/20 points] - [Description]

**Assessment**:
[Detailed explanation of operational readiness]

**Readiness Gaps**:

- [Gap 1]: [Description and risk]
- [Gap 2]: [Description and risk]

**Recommendations**:

- [Specific recommendation 1]
- [Specific recommendation 2]

---

## Production Readiness Assessment

### Gate 1: Design Review

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] All access patterns documented with frequency
- [ ] Partition key cardinality validated (> 1000 unique values)
- [ ] Index strategy justified and validated
- [ ] Capacity calculations reviewed and approved
- [ ] Cost analysis completed and approved
- [ ] Security requirements met
- [ ] Peer review completed

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Gate 2: Implementation Review

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] Infrastructure code reviewed (CDK/CloudFormation)
- [ ] All security settings enabled (encryption, IAM)
- [ ] Monitoring and alarms configured
- [ ] Backup strategy implemented (PITR, on-demand)
- [ ] Example queries tested and validated
- [ ] Error handling validated (retry logic, exponential backoff)
- [ ] Documentation complete (runbook, troubleshooting)

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Gate 3: Load Testing

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] Partition distribution validated (no hot partitions)
- [ ] Query latency meets requirements (p99 < 50ms)
- [ ] No throttling at 2× expected peak load
- [ ] GSI backfill tested (if applicable)
- [ ] Failure scenarios tested (throttling, timeouts)
- [ ] Monitoring validated (metrics, alarms working)
- [ ] Runbook validated with test scenarios

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Gate 4: Production Validation

**Status**: [ PASS / NEEDS WORK / BLOCKED]

**Checklist**:

- [ ] CloudWatch metrics reviewed (no throttling)
- [ ] Partition distribution monitored (no hot partitions)
- [ ] Query latency within SLA (p99, p95, p50)
- [ ] Error rates acceptable (< 0.1%)
- [ ] Cost tracking enabled and reviewed
- [ ] No unexpected capacity consumption
- [ ] Team trained on monitoring and troubleshooting

**Blockers**: [List any blocking issues, or "None" if passing]

**Required Actions**: [List actions needed to pass this gate]

---

### Overall Production Readiness

**Status**: [ READY FOR PRODUCTION / READY WITH CAVEATS / NOT READY]

**Summary**: [Brief explanation of overall readiness status]

**Gates Passed**: [X]/4

**Critical Blockers**: [List critical blockers preventing production deployment]

**Recommended Timeline**:

- Gate 1 completion: [Estimate or "Complete"]
- Gate 2 completion: [Estimate or "Complete"]
- Gate 3 completion: [Estimate or "Complete"]
- Gate 4 completion: [Estimate or "Complete"]
- **Production Ready**: [Date estimate or "Ready now"]

---

## Iteration Progress

[If this is first review: " This is the initial baseline validation. Save this report for future comparison."]

[If this is a re-validation:]

### Comparison to Previous Review

**Previous Validation Date**: [YYYY-MM-DD]
**Current Validation Date**: [YYYY-MM-DD]

**Score Changes**:

- **Previous Overall Score**: [X]/100
- **Current Overall Score**: [Y]/100
- **Improvement**: [+/-Z] points ([+/-W]%)

**Status Change**: [Previous Status] → [Current Status]

---

### Issues Resolved Since Last Review

[If no issues resolved: " No issues from previous review have been resolved."]

[Otherwise:]

**Resolved Issues** ([X] total):

1. **[Issue Title]** (was [Priority])
   - Resolution: [How it was fixed]
   - Impact: [Benefit gained]

2. **[Issue Title]** (was [Priority])
   - Resolution: [How it was fixed]
   - Impact: [Benefit gained]

---

### Issues Remaining from Previous Review

[If no remaining issues: " All issues from previous review have been resolved!"]

[Otherwise:]

**Unresolved Issues** ([X] total):

1. **[Issue Title]** ([Priority])
   - Status: [Unchanged / Partially improved]
   - Reason: [Why still present]

2. **[Issue Title]** ([Priority])
   - Status: [Unchanged / Partially improved]
   - Reason: [Why still present]

---

### New Issues Identified

[If no new issues: " No new issues introduced since last review."]

[Otherwise:]

**New Issues** ([X] total):

1. **[Issue Title]** ([Priority])
   - Cause: [Why this is new - e.g., "New access pattern added"]

2. **[Issue Title]** ([Priority])
   - Cause: [Why this is new]

---

### Iteration Summary

**Progress Assessment**: [Excellent / Good / Minimal / Regressed]

**Key Improvements**:

- [Improvement 1]
- [Improvement 2]

**Persistent Challenges**:

- [Challenge 1]
- [Challenge 2]

**Recommended Focus for Next Iteration**:

1. [Priority 1 recommendation]
2. [Priority 2 recommendation]
3. [Priority 3 recommendation]

---

## Recommendations Summary

### Immediate Actions (Critical/High Priority)

**Must address before production deployment**:

1. **[Action 1]** (Critical)
   - Issue: [Brief description]
   - Impact: [Key impact]
   - Effort: [Low/Medium/High]

2. **[Action 2]** (High)
   - Issue: [Brief description]
   - Impact: [Key impact]
   - Effort: [Low/Medium/High]

**Total Estimated Effort**: [X] hours

---

### Future Improvements (Medium/Low Priority)

**Consider for next iteration**:

1. **[Action 1]** (Medium)
   - Benefit: [Key benefit]
   - Effort: [Low/Medium/High]

2. **[Action 2]** (Low)
   - Benefit: [Key benefit]
   - Effort: [Low/Medium/High]

**Total Estimated Effort**: [X] hours
**Total Potential Savings**: $[Y]/month

---

## Next Steps

1. **Review Findings**: Discuss critical and high priority issues with team
2. **Prioritize Fixes**: Determine which issues to address in next iteration
3. **Implement Changes**: Apply recommended fixes to design
4. **Re-validate**: Submit updated design for validation
5. **Track Progress**: Compare scores to measure improvement

---

## Additional Resources

**AWS Documentation**:

- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Partition Key Design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)
- [Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [DynamoDB Pricing](https://aws.amazon.com/dynamodb/pricing/)

**Organizational Resources**:
[If organizational standards provided, list relevant links]

---

**Report Generated**: [Timestamp]
**Validation Tool**: DynamoDB Design Checker
```

---

## Quality Gate

**CRITICAL (must fix):**

- Hot partition detected — write throughput concentrated on predictable key values
- Required access pattern has no supporting index
- Encryption at rest not configured
- No backup strategy defined

**IMPORTANT (should fix):**

- GSI projection includes unnecessary attributes (increases cost)
- Item sizes exceed 10KB average (impacts cost and performance)
- No CloudWatch alarms defined for throttling

**SUGGESTION:**

- Could add DAX caching for read-heavy access patterns
- Could optimize GSI key design to reduce storage cost

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
