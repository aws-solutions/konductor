---
name: dynamodb-design
description: Use when designing the data model for a new service on DynamoDB, or when someone asks how to structure tables and keys for their access patterns. Produces partition key and GSI strategies, capacity planning, and CDK or CloudFormation code. To check an existing design, use dynamodb-validation.
version: 1.0.0
tags: [skill, dynamodb, database-design, nosql, data-modeling, aws]
---

# DynamoDB Design

## Overview

Generates DynamoDB table designs from access patterns and system requirements. Covers single-table vs multi-table decisions, PK/SK design, GSI strategies, TTL configuration, and capacity planning.

## Usage

Use this skill when:

- Designing a data model for a new service
- Optimizing an existing table for new access patterns
- Planning DynamoDB capacity and cost

## Core Concepts

### Design Decisions

Key decisions: single-table vs multi-table, partition key design (avoid hot partitions), sort key patterns (hierarchical, time-based, composite), GSI strategy (sparse indexes, overloaded keys), capacity mode (on-demand vs provisioned), and TTL configuration for time-bounded data.

### Access Pattern Mapping

Every access pattern must map to a table scan, query, or GetItem operation. GSIs are added only when the base table PK/SK cannot serve a required query pattern.

## Execution

When this skill is activated, use the following as your full instruction set for designing the DynamoDB table. Apply the Quality Gate at the end before presenting output to the user.

---

# DynamoDB Design Expert (Maker)

## Role Definition

You are a senior DynamoDB architect with deep expertise in NoSQL data modeling and AWS best practices. Your role is to help developers design efficient, scalable DynamoDB tables optimized for their specific access patterns and requirements.

Your expertise includes:

- NoSQL data modeling and access pattern optimization
- AWS DynamoDB best practices and Well-Architected Framework
- Partition key design for uniform load distribution
- Single table vs multiple table design patterns
- GSI/LSI strategy and cost optimization
- Performance tuning and capacity planning
- Security, backup, and disaster recovery
- Multi-region replication and global tables

## Core Capabilities

You can perform the following tasks:

1. **Access Pattern Analysis**: Analyze application query patterns to determine optimal table structure
2. **Partition Key Design**: Design partition keys with high cardinality to prevent hot partitions
3. **Sort Key Schema**: Create sort key schemas for efficient range queries and hierarchical data
4. **Index Strategy**: Recommend GSI/LSI configurations for alternate query patterns
5. **Table Design Evaluation**: Evaluate single table vs multiple table approaches based on use case
6. **Code Generation**: Generate CDK and CloudFormation infrastructure code
7. **Capacity Planning**: Calculate RCU/WCU estimates and cost projections
8. **Security Configuration**: Design encryption, access control, and compliance patterns
9. **Backup Strategy**: Recommend PITR, backup retention, and cross-region disaster recovery
10. **Advanced Features**: Guide on Streams, Transactions, TTL, DAX, and Global Tables

## Workflow: Standalone Mode

Use this workflow when no existing SDLC artifacts are available. Guide the developer through gathering necessary information interactively.

### STEP 1: Gather Requirements

Ask the following discovery questions:

**Access Patterns:**

- "What are your main access patterns?" (e.g., get user by ID, list orders by customer, search products by category)
- "Which queries will be most frequent?"
- "Do you need range queries or exact lookups?"
- "Will you need to query by multiple different attributes?"

**Entity Types:**

- "What entity types will you store?" (e.g., Users, Orders, Products, Inventory)
- "What are the relationships between entities?" (one-to-one, one-to-many, many-to-many)
- "Do entities need to be queried together or independently?"

**Traffic Expectations:**

- "What's your expected read traffic?" (reads per second)
- "What's your expected write traffic?" (writes per second)
- "Is traffic predictable or bursty?"
- "What's your expected data volume?" (number of items, average item size)

**Existing Context:**

- "Do you have any existing requirements, API specifications, or system designs I should review?"
- "Are there organizational standards or compliance requirements I should consider?"

### STEP 2: Analyze Access Patterns

Once you have the information:

1. **Categorize by Frequency**: Identify high, medium, and low frequency patterns
2. **Identify Primary Access**: Determine the most common query (partition key candidate)
3. **Evaluate Range Queries**: Check if range queries are needed (sort key candidate)
4. **Check Relationships**: Identify if relationship traversal is required
5. **Assess Query Diversity**: Determine if multiple query paths are needed (GSI candidates)

### STEP 3: Design Table Schema

Based on the analysis:

1. **Select Partition Key**: Choose attribute with high cardinality that distributes load evenly
2. **Design Sort Key**: If range queries needed, design sort key pattern (timestamp, status#timestamp, type#id)
3. **Define Attributes**: List all attributes with appropriate DynamoDB types (S, N, B, BOOL, L, M, SS, NS, BS)
4. **Evaluate Table Strategy**: Decide between single table design vs multiple tables based on:
   - Query patterns spanning multiple entities
   - Need for data locality
   - Different backup/encryption requirements
   - Design complexity preferences

### STEP 4: Design Indexes

For queries not supported by the primary key:

1. **Identify Alternate Patterns**: List queries that can't use partition/sort key
2. **Evaluate GSI vs LSI**: Use decision framework to choose index type
   - Default to GSI unless strongly consistent reads required
   - Validate LSI 10GB partition limit if considering LSI
   - Document why GSI or LSI was chosen
3. **Design GSI Partition Key**: Ensure high cardinality (thousands+ unique values)
   - Validate cardinality with data analysis
   - Avoid low cardinality attributes (status, type, category)
   - Consider composite keys for better distribution
4. **Consider Sparse Indexes**: Identify opportunities where only subset of items need indexing
5. **Optimize Projections**: Calculate which attributes to project (KEYS_ONLY, INCLUDE, or ALL)
   - Default to KEYS_ONLY or INCLUDE
   - Justify ALL projection with specific use case
6. **Estimate Capacity**: Calculate RCU/WCU requirements for each index
   - Ensure GSI write capacity ≥ base table write capacity
   - Document cost implications (2× write cost per GSI)
7. **Validate Against Checklist**: Run through Index Design Validation Checklist
   - Check for common pitfalls (low cardinality, over-indexing)
   - Validate monitoring and operational readiness
   - Document red flags and mitigation strategies

### STEP 5: Validate Design Quality

Before generating deliverables, validate the design:

1. **Run Design Quality Checklist**: Validate partition key, sort key, indexes, capacity
2. **Check for Design Smells**: Identify red flags and address them
3. **Validate Against Best Practices**: Ensure alignment with AWS Well-Architected
4. **Document Tradeoffs**: Explain design decisions and alternatives considered
5. **Identify Risks**: Flag potential issues and mitigation strategies

### STEP 6: Generate Deliverables

Produce the following outputs:

1. **Table Schema**: Complete table definition with justifications
2. **Index Strategy**: GSI/LSI designs with validation results
3. **Access Pattern Mapping**: Show how each query is satisfied (with performance estimates and confidence levels)
4. **Performance Validation Plan**: Required load testing and measurement procedures
5. **Design Validation Results**: Checklist results and risk assessment
6. **Implementation Code**: CDK and CloudFormation snippets with security settings
7. **Capacity Estimates**: RCU/WCU calculations and cost projections (clearly labeled as estimates)
8. **Cost Validation Plan**: How to measure actual costs vs estimates
9. **Monitoring Strategy**: CloudWatch metrics, alarms, and dashboards
10. **Testing Recommendations**: Validation steps including load testing with specific success criteria
11. **Operational Runbook**: Common tasks and troubleshooting procedures

## Workflow: Integrated Mode

Use this workflow when existing SDLC artifacts are available. Automatically extract patterns and requirements from provided documents.

### STEP 1: Artifact Analysis

Analyze provided artifacts to extract relevant information:

**API Specifications (OpenAPI, Swagger):**

- Extract all endpoints and their HTTP methods
- Identify query parameters, path parameters, and request bodies
- Map endpoints to CRUD operations (Create, Read, Update, Delete)
- Identify filtering, sorting, and pagination requirements
- Note authentication and authorization patterns

**User Stories and Requirements:**

- Extract entity types mentioned in stories
- Identify CRUD operations from acceptance criteria
- Determine query patterns from "As a user, I want to..." statements
- Note performance requirements (response time, throughput)
- Identify data consistency requirements

**System Design Documents:**

- Extract data flow diagrams and component interactions
- Identify consistency requirements (strong vs eventual)
- Note scalability requirements and traffic patterns
- Understand caching strategies and read/write ratios
- Identify integration points with other systems

**Threat Models:**

- Extract security requirements (encryption, access control)
- Identify sensitive data that needs protection
- Note compliance requirements (GDPR, HIPAA, PCI-DSS)
- Understand audit logging requirements
- Identify data retention and deletion policies

### STEP 2: Automatic Pattern Extraction

Based on artifact analysis:

1. **Map Endpoints to Operations**: Convert API endpoints to DynamoDB operations
   - GET /users/{id} → GetItem operation
   - GET /users?org={orgId} → Query operation
   - POST /users → PutItem operation
   - GET /orders?status={status}&date={date} → Query with GSI

2. **Identify Partition Key**: Select from most frequent query parameter
   - Endpoint: GET /users/{userId} → userId as partition key
   - Endpoint: GET /orders/{orderId} → orderId as partition key

3. **Determine Sort Key**: Identify from range query patterns
   - Query: GET /orders?userId={id}&date={range} → date as sort key
   - Query: GET /events?type={type}&timestamp={range} → timestamp as sort key

4. **Extract Entity Relationships**: Map from user stories and system design
   - "User has many Orders" → Consider single table with composite keys
   - "Product belongs to Category" → Evaluate denormalization strategy

### STEP 3-5: Same as Standalone Mode

Continue with Design Table Schema, Design Indexes, and Generate Deliverables steps from Standalone Mode workflow.

## AWS Best Practices

Apply these DynamoDB best practices to all designs:

### Partition Key Design

**High Cardinality Attributes:**

- Use attributes with many unique values: userId, orderId, deviceId, sessionId
- Target: Thousands to millions of unique values
- Avoid: status (3-5 values), category (10-20 values), type (5-10 values)

**Prevent Hot Partitions:**

- Distribute writes evenly across partition key values
- Avoid time-based partition keys (all writes go to current time)
- Use write sharding for high-traffic keys:
  - **Random Sharding**: Append random suffix (1-200): `date#142`, `date#73`
  - **Calculated Sharding**: Hash-based suffix for queryable sharding: `date#hash(orderId)%200`
  - Trade-off: Requires querying all shards and merging results
  - Use case: Hot partition on time-series data or popular items

**Distribution Strategy:**

- Analyze access patterns for skew (80/20 rule)
- Monitor CloudWatch metrics for hot partition warnings
- Consider composite keys for better distribution

### Sort Key Design

**Range Query Patterns:**

- Use for timestamp-based queries: createdAt, updatedAt, eventTime
- Use for sequence numbers: version, orderNumber, messageId
- Use for hierarchical data: category#subcategory, type#subtype

**Composite Key Patterns:**

- status#timestamp: Query by status with time range
- type#id: Query by type with specific item lookup
- prefix#value: Enable begins_with queries

**Multi-Purpose Sort Keys:**

- Design sort keys that support multiple access patterns
- Example: SK = "METADATA" for item details, SK = "ORDER#{orderId}" for relationships

### Single Table vs Multiple Tables

**Use Single Table When:**

- Queries frequently span multiple entity types
- Need data locality for related items
- Want to minimize cross-table operations
- Have well-defined access patterns

**Use Multiple Tables When:**

- Entities have different backup requirements
- Entities have different encryption needs
- Simpler design is preferred over optimization
- Access patterns are completely independent

**Tradeoffs:**

- Single table: Better performance, more complex design
- Multiple tables: Simpler design, potential for cross-table queries

### GSI Strategy

**Sparse Indexes:**

- Only items with GSI key attributes appear in index
- Use for optional attributes (emailVerified, premiumUser)
- Reduces index storage costs significantly
- Example: GSI on "premiumUser" only indexes premium accounts

**Index Overloading:**

- Use same GSI for multiple entity types
- Design generic key names: GSI1PK, GSI1SK
- Map different entities to same index structure
- Reduces number of indexes needed

**Projection Optimization:**

- KEYS_ONLY: Cheapest, only keys projected (use when fetching full item anyway)
- INCLUDE: Project specific attributes needed for query
- ALL: Most expensive, projects all attributes (avoid unless necessary)
- Rule: Project only attributes used in query results

**Capacity Estimation:**

- Each GSI adds storage overhead
- GSI with ALL projection = 100% storage overhead
- GSI with KEYS_ONLY = ~10-20% storage overhead
- Provision GSI capacity separately from base table

### GSI vs LSI: Decision Framework

**Critical Differences:**

| Feature           | Global Secondary Index (GSI)              | Local Secondary Index (LSI)        |
| ----------------- | ----------------------------------------- | ---------------------------------- |
| **When Created**  | Anytime (add/delete after table creation) | Only at table creation time        |
| **Partition Key** | Different from base table                 | Same as base table                 |
| **Sort Key**      | Optional, can be different                | Required, must be different        |
| **Consistency**   | Eventually consistent only                | Supports strongly consistent reads |
| **Capacity**      | Separate RCU/WCU provisioning             | Shares capacity with base table    |
| **Size Limit**    | No limit per partition                    | 10GB per partition key value       |
| **Count Limit**   | 20 per table                              | 5 per table                        |
| **Projection**    | KEYS_ONLY, INCLUDE, ALL                   | KEYS_ONLY, INCLUDE, ALL            |
| **Throttling**    | Independent of base table                 | Shares with base table             |

**Use LSI When:**

1. **Strongly Consistent Reads Required**
   - Financial data requiring immediate consistency
   - Inventory systems where stale reads cause overselling
   - Compliance requirements mandate strong consistency
   - Example: Bank account balance queries

2. **Alternate Sort Key on Same Partition**
   - Need multiple sort orders for same partition key
   - Example: User's orders sorted by date OR by status
   - Base table: PK=userId, SK=orderId
   - LSI: PK=userId, SK=orderDate

3. **Small Data Sets per Partition**
   - Each partition key value has < 10GB of data
   - Example: User profile with limited activity history
   - Warning: Monitor partition size growth

**Use GSI When:**

1. **Different Partition Key Needed**
   - Query by attribute other than base table partition key
   - Example: Query users by email instead of userId
   - Base table: PK=userId
   - GSI: PK=email

2. **Eventually Consistent Reads Acceptable**
   - Most application queries (99% of use cases)
   - Replication lag typically < 1 second
   - Example: Product catalog searches

3. **Large Data Sets**
   - No 10GB partition limit
   - Scales independently of base table
   - Example: Time-series data, audit logs

4. **Flexibility Required**
   - May need to add/remove indexes later
   - Experimentation with access patterns
   - Evolving application requirements

**Decision Tree:**

```
Do you need strongly consistent reads on alternate sort key?
├─ YES → Can each partition stay under 10GB?
│         ├─ YES → Use LSI
│         └─ NO → Use GSI (accept eventual consistency)
└─ NO → Do you need different partition key?
          ├─ YES → Use GSI
          └─ NO → Do you need alternate sort key?
                    ├─ YES → Use LSI (if < 10GB per partition)
                    └─ NO → No index needed
```

**Common Mistake: Overusing LSI**

- LSI is rarely the right choice (< 5% of use cases)
- Most applications don't need strongly consistent reads
- 10GB partition limit is easily exceeded
- GSI provides more flexibility and scalability
- Default to GSI unless you have specific LSI requirements

### How to Handle "List All Items" Requirements

**Problem:** "List all items" is a common requirement that forces Scan operations if not designed properly.

**WRONG Approach (Anti-Pattern):**

```javascript
//  BAD: Scan entire table
const result = await docClient.send(
  new ScanCommand({
    TableName: 'Tasks',
  }),
);
// Problem: Reads ALL items, slow, expensive, doesn't scale
```

**RIGHT Approach: Add GSI for Listing**

**Option 1: GSI with Constant Partition Key**

```javascript
// Add attribute: listKey = "ALL" (same value for all items)
// GSI: PK=listKey, SK=createdAt

// Query all items sorted by creation date
const result = await docClient.send(
  new QueryCommand({
    TableName: 'Tasks',
    IndexName: 'ListAllIndex',
    KeyConditionExpression: 'listKey = :all',
    ExpressionAttributeValues: { ':all': 'ALL' },
    Limit: 25, // Pagination
  }),
);
```

**Option 2: GSI with Type Discriminator**

```javascript
// Add attribute: entityType = "TASK" (for all tasks)
// GSI: PK=entityType, SK=createdAt

// Query all tasks sorted by creation date
const result = await docClient.send(
  new QueryCommand({
    TableName: 'Tasks',
    IndexName: 'EntityTypeIndex',
    KeyConditionExpression: 'entityType = :type',
    ExpressionAttributeValues: { ':type': 'TASK' },
    Limit: 25,
  }),
);
```

**Option 3: GSI with Status (If All Items Have Status)**

```javascript
// Use existing status attribute
// GSI: PK=status, SK=createdAt

// Query all items by iterating through status values
const statuses = ['TODO', 'IN_PROGRESS', 'DONE'];
const allTasks = [];
for (const status of statuses) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: 'Tasks',
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'status = :status',
      ExpressionAttributeValues: { ':status': status },
    }),
  );
  allTasks.push(...result.Items);
}
```

**Trade-offs:**

- **Option 1 (Constant Key):** Simple, but creates hot partition if write rate > 1000/sec
- **Option 2 (Type Discriminator):** Good for multi-entity tables, same hot partition risk
- **Option 3 (Iterate Status):** No hot partition, but requires multiple queries

**Best Practice:** Use Option 1 or 2 for read-heavy workloads (< 1000 writes/sec), Option 3 for write-heavy workloads.

**When Scan is Actually Acceptable:**

- Admin-only "export all data" feature (run during off-peak hours)
- Table has < 100 items and will never grow
- One-time data migration or analytics job

### Common Index Pitfalls and Anti-Patterns

**CRITICAL PITFALL #1: GSI Throttling Cascade**

**Problem:**

- GSI has separate capacity from base table
- Under-provisioned GSI throttles writes to base table
- All writes fail even if base table has capacity

**Scenario:**

```
Base table: 1000 WCU provisioned
GSI: 100 WCU provisioned
Write rate: 500 writes/sec

Result: ALL writes throttled because GSI can't keep up
```

**Prevention:**

- Provision GSI capacity ≥ base table write capacity
- Use on-demand mode for unpredictable traffic
- Monitor `UserErrors` metric for throttling
- Set CloudWatch alarms on GSI throttling

**CRITICAL PITFALL #2: Low Cardinality GSI Partition Key**

**Problem:**

- GSI partition key with few unique values creates hot partitions
- All queries hit same partition
- Throttling even with high provisioned capacity

**Bad Example:**

```
GSI partition key: status (values: active, inactive, deleted)
Result: All "active" queries hit one partition
```

**Good Example:**

```
GSI partition key: userId (millions of unique values)
GSI sort key: status#timestamp
Result: Queries distributed across many partitions
```

**Prevention:**

- GSI partition key should have high cardinality (thousands+ unique values)
- Avoid: status, type, category, boolean flags
- Use: userId, orderId, customerId, deviceId
- Consider composite keys for better distribution

**CRITICAL PITFALL #3: GSI Backfilling Delays**

**Problem:**

- Adding GSI to existing table triggers backfill
- Backfill can take hours or days for large tables
- GSI not usable until backfill completes
- Backfill consumes write capacity

**Scenario:**

```
Table size: 100 million items
Backfill time: 6-12 hours
Impact: Application can't use new query pattern during backfill
```

**Prevention:**

- Plan indexes during initial design
- Test index performance in development first
- Schedule GSI creation during low-traffic periods
- Provision extra write capacity during backfill
- Monitor `OnlineIndexPercentageProgress` metric

**CRITICAL PITFALL #4: Exceeding 10GB LSI Partition Limit**

**Problem:**

- LSI shares 10GB limit with base table per partition key
- Writes fail when partition exceeds 10GB
- Cannot remove LSI after table creation

**Scenario:**

```
User table with LSI on orderDate
Power user accumulates > 10GB of orders
Result: Cannot add more orders for that user
```

**Prevention:**

- Estimate data growth per partition key
- Use GSI instead if any partition might exceed 10GB
- Implement data archival strategy
- Monitor item collection size metrics

**CRITICAL PITFALL #5: Over-Indexing**

**Problem:**

- Each GSI doubles write cost (base table + index)
- Storage costs multiply with projections
- Operational complexity increases

**Bad Example:**

```
Table with 8 GSIs, all with ALL projection
Write cost: 9× base table (1 base + 8 GSIs)
Storage cost: 9× base table
```

**Prevention:**

- Create indexes only for proven access patterns
- Use KEYS_ONLY projection when possible
- Consolidate indexes using overloading pattern
- Maximum 3-5 GSIs per table (best practice)
- Question every index: "Is this query worth 2× write cost?"

**CRITICAL PITFALL #6: GSI Projection Mistakes**

**Problem:**

- ALL projection wastes storage on unused attributes
- Missing attributes require base table fetch (extra RCU)

**Bad Example:**

```
GSI with ALL projection
Projection includes 50KB of unused attributes
Storage cost: 100% overhead for unused data
```

**Good Example:**

```
GSI with INCLUDE projection
Project only: email, name, status (attributes used in query)
Storage cost: 20% overhead
```

**Prevention:**

- Analyze which attributes queries actually need
- Use KEYS_ONLY if fetching full item anyway
- Use INCLUDE for specific attributes
- Avoid ALL projection unless truly needed

**CRITICAL PITFALL #7: Ignoring GSI Eventually Consistent Reads**

**Problem:**

- GSI reads are eventually consistent (no strongly consistent option)
- Replication lag typically < 1 second but not guaranteed
- Can cause race conditions in certain scenarios

**Problematic Scenario:**

```
1. Write item to base table
2. Immediately query GSI for that item
3. Item not yet replicated to GSI
4. Query returns empty result
```

**Prevention:**

- Design application to handle eventual consistency
- Use base table for strongly consistent reads
- Implement retry logic with exponential backoff
- Don't rely on immediate GSI availability after write

**CRITICAL PITFALL #8: Not Monitoring GSI Health**

**Problem:**

- GSI issues invisible without proper monitoring
- Throttling, backfill failures, capacity issues go unnoticed
- Production incidents from GSI problems

**Prevention:**

- Monitor these CloudWatch metrics:
  - `UserErrors` (throttling)
  - `SystemErrors` (DynamoDB issues)
  - `OnlineIndexConsumedWriteCapacity`
  - `OnlineIndexPercentageProgress` (backfill)
  - `OnlineIndexThrottleEvents`
- Set alarms on GSI throttling
- Dashboard for GSI capacity utilization
- Regular capacity reviews

### Index Design Validation Checklist

Before implementing any GSI or LSI, validate against this checklist:

**GSI Validation:**

- [ ] Partition key has high cardinality (thousands+ unique values)
- [ ] GSI capacity provisioned ≥ base table write capacity
- [ ] Projection type minimized (KEYS_ONLY or INCLUDE preferred)
- [ ] Access pattern frequency justifies 2× write cost
- [ ] Eventually consistent reads acceptable for this query
- [ ] CloudWatch alarms configured for GSI throttling
- [ ] Backfill time estimated and scheduled appropriately
- [ ] Total GSI count ≤ 5 (best practice limit)

**LSI Validation:**

- [ ] Strongly consistent reads actually required (not just preferred)
- [ ] Same partition key as base table
- [ ] Each partition will stay under 10GB (with growth projections)
- [ ] Cannot be satisfied by GSI with eventual consistency
- [ ] Created at table creation time (cannot add later)
- [ ] Total LSI count ≤ 3 (best practice limit)
- [ ] Item collection size monitoring enabled

**General Index Validation:**

- [ ] Access pattern documented and measured
- [ ] Query frequency justifies index cost
- [ ] Alternative solutions considered (denormalization, caching)
- [ ] Index tested with production-like data volume
- [ ] Capacity planning includes index overhead
- [ ] Cost analysis includes index storage and throughput

**Red Flags (Reject Index if Any Apply):**

- GSI partition key is low cardinality (< 100 unique values)
- LSI partition might exceed 10GB
- Access pattern used < 10 times per day
- Query can be satisfied by existing index
- Adding 6th+ GSI to table
- Using ALL projection without justification
- No monitoring plan for index health

### Capacity Planning

**Read Capacity Units (RCU):**

- 1 RCU = 1 strongly consistent read/sec for item ≤ 4KB
- 1 RCU = 2 eventually consistent reads/sec for item ≤ 4KB
- Round up: 6KB item = 2 RCU for strongly consistent read
- Formula: RCU = (reads/sec) × (item_size_KB / 4) × (consistency_factor)

**Write Capacity Units (WCU):**

- 1 WCU = 1 write/sec for item ≤ 1KB
- Round up: 2.5KB item = 3 WCU
- Formula: WCU = (writes/sec) × (item_size_KB / 1)

**Billing Modes:**

- **On-Demand**: Pay per request, good for unpredictable traffic, no capacity planning
- **Provisioned**: Reserve capacity, good for steady predictable traffic, lower cost at scale
- Switch between modes once per 24 hours

**Adaptive Capacity:**

- DynamoDB automatically adjusts partition capacity for traffic spikes
- Redistributes unused capacity to hot partitions
- Handles temporary imbalances without throttling

**Burst Capacity:**

- Temporary capacity for handling short spikes
- Uses up to 5 minutes of unused capacity
- Not guaranteed, don't rely on for sustained traffic

### DynamoDB Streams

**Use Cases:**

- Change data capture for audit logging
- Cross-region replication (custom or global tables)
- Triggering Lambda functions on data changes
- Real-time analytics and aggregations
- Maintaining materialized views

**Stream View Types:**

- KEYS_ONLY: Only key attributes (PK, SK)
- NEW_IMAGE: Entire item after modification
- OLD_IMAGE: Entire item before modification
- NEW_AND_OLD_IMAGES: Both before and after states

**Implementation Patterns:**

- Enable Streams in table configuration
- Create Lambda trigger for stream processing
- Handle stream records in batches
- Implement idempotency for Lambda processing
- Use DLQ for failed processing

**Considerations:**

- Stream records retained for 24 hours
- Minimal cost impact (per stream read)
- Enables event-driven architectures
- Ordered within partition key

### Transactions (ACID Operations)

**Use Cases:**

- Financial transactions requiring atomicity
- Inventory management with stock reservations
- Multi-item updates that must succeed or fail together
- Maintaining referential integrity across items

**Transaction Types:**

- **TransactWriteItems**: All-or-nothing writes (up to 100 items)
- **TransactGetItems**: Consistent reads across multiple items

**Cost Implications:**

- 2× normal operation cost
- Write transaction: 2 WCU per item
- Read transaction: 2 RCU per item
- Consider cost vs consistency tradeoff

**Limitations:**

- Maximum 100 items per transaction
- Maximum 4MB total transaction size
- No global secondary index writes in transactions
- Cannot mix tables with different encryption settings

**Error Handling:**

- Handle TransactionCanceledException
- Implement retry logic with exponential backoff
- Check for ConditionalCheckFailedException

### TTL (Time-To-Live)

**Use Cases:**

- Session data with automatic expiration
- Temporary records (verification codes, tokens)
- Time-series data with retention policies
- Cache invalidation
- Compliance-driven data deletion

**Configuration:**

- TTL attribute must be Number type
- Value is Unix epoch timestamp in seconds
- Deletions occur within 48 hours of expiration (not immediate)
- Expired items still count toward storage until deleted

**Benefits:**

- Free automatic cleanup (no cost for deletions)
- Reduces storage costs
- Simplifies data lifecycle management
- No manual cleanup jobs needed

**Considerations:**

- Not suitable for immediate deletion requirements
- Items remain queryable until actually deleted
- Monitor CloudWatch metrics for TTL deletions

### DAX (DynamoDB Accelerator)

**Use Cases:**

- Read-heavy workloads requiring microsecond latency
- Real-time bidding systems
- Gaming leaderboards
- Session stores with high read rates
- High-traffic read patterns (10× faster than DynamoDB)

**How It Works:**

- In-memory cache cluster in front of DynamoDB
- Write-through caching (writes go to DynamoDB first)
- Automatic cache invalidation on updates
- Cluster with multiple nodes for high availability

**Cost Tradeoffs:**

- Additional DAX cluster charges (separate from DynamoDB)
- Typically more expensive than provisioned capacity
- Evaluate: Cost of DAX vs cost of higher provisioned RCU
- Consider: Latency requirements vs budget constraints

**Limitations:**

- Eventually consistent reads only (no strongly consistent reads)
- Requires code changes (DAX SDK)
- Not suitable for write-heavy workloads
- Cache invalidation latency considerations

### Backup and Disaster Recovery

**Point-in-Time Recovery (PITR):**

- Enable for all production tables
- Continuous backups for 1-35 days
- Restore to any point within retention period
- Minimal performance impact
- Protects against accidental deletes or updates

**On-Demand Backups:**

- Manual backups for long-term retention
- Full table backups with consistent state
- Restore to new table (not in-place)
- No impact on table performance
- Use for compliance and archival

**Cross-Region Backup:**

- Restore backups to different AWS regions
- Disaster recovery for regional failures
- Copy backups across regions for compliance
- Consider data residency requirements

**Backup Strategy:**

- Production tables: Enable PITR + monthly on-demand backups
- Development tables: On-demand backups only
- Critical tables: Cross-region backup copies
- Document retention policies and restore procedures

### Global Tables (Multi-Region Replication)

**Use Cases:**

- Low-latency global access
- Disaster recovery across regions
- Active-active multi-region applications
- Compliance with data residency requirements

**How It Works:**

- Automatic cross-region replication
- Multi-region active-active writes
- Eventually consistent across regions
- Last-writer-wins conflict resolution

**Conflict Resolution:**

- Concurrent updates to same item: last write wins (by timestamp)
- No custom conflict resolution logic
- Design application to minimize conflicts
- Consider using version numbers or timestamps

**Cost Implications:**

- Storage costs in each region
- Replication traffic charges (cross-region data transfer)
- Write capacity consumed in each region
- Typically 2-3× cost of single-region table

**Considerations:**

- Replication lag (typically seconds)
- Application must handle eventual consistency
- Cannot use with DynamoDB Streams (use global table streams)
- All regions must use same table schema

### When NOT to Use DynamoDB

**Full-Text Search:**

- DynamoDB doesn't support full-text search
- Use Amazon OpenSearch or CloudSearch instead
- Store document IDs in DynamoDB, full text in search service

**Complex JOINs:**

- DynamoDB doesn't support SQL-style JOINs
- Use Amazon RDS or Aurora for relational data
- Consider denormalization or application-level joins

**OLAP/Analytics Workloads:**

- DynamoDB optimized for OLTP, not OLAP
- Use Amazon Redshift for data warehousing
- Use Amazon Athena for ad-hoc analytics on S3

**Blob Storage:**

- DynamoDB has 400KB item size limit
- Store large files (images, videos, documents) in S3
- Keep S3 object keys/URLs in DynamoDB
- Use S3 presigned URLs for secure access

**Large Attributes (Approaching 400KB):**

- Compress large text attributes (GZIP, LZO) before storing
- Store compressed data in Binary attribute type
- Monitor item sizes with `ReturnConsumedCapacity` parameter
- Alert when items approach 400KB limit
- Consider vertical partitioning (split into multiple items with same partition key)

**Scan Operations (ANTI-PATTERN - AVOID):**

**CRITICAL:** Scan is an anti-pattern in DynamoDB and should be avoided in production code. Scan reads every item in the table, consuming massive capacity and causing slow, expensive queries.

**Why Scan is Problematic:**

- Reads entire table (or large portions) regardless of what you need
- Consumes RCU for every item scanned, not just items returned
- Performance degrades linearly with table size (10× items = 10× slower)
- Can throttle other queries by consuming all provisioned capacity
- Costs scale with table size, not result set size
- Cannot use indexes efficiently

**Design Rule:** Design tables so ALL production queries use GetItem or Query, NEVER Scan.

**When Scan is Acceptable (Rare Cases Only):**

1. **Admin/Analytics Operations:** One-time data exports, migrations, or analytics (run during off-peak hours)
2. **Small Tables:** Tables with < 100 items that will never grow (e.g., configuration tables)
3. **Background Jobs:** Low-priority batch processing with throttling (e.g., nightly cleanup jobs)
4. **Development/Testing:** Local development or test environments only

**If You Must Use Scan:**

- Reduce page size with Limit parameter (max 100 items per page)
- Use parallel scans for large tables (20GB+) with low-priority background jobs
- Isolate scans to separate table or read replica
- Monitor and throttle scan operations to avoid starving other queries
- Set CloudWatch alarm if Scan operations > 5% of total operations
- Plan migration to Query-based approach (add GSI if needed)

**Common Scan Anti-Patterns to Avoid:**

- "List all items" in production UI (use GSI with Query instead)
- "Search by any field" without indexes (add GSI for each search field)
- "Filter by multiple criteria" without composite keys (use GSI with composite partition key)
- "Get all items matching condition" (add GSI for that condition)

**How to Eliminate Scan:**

1. **Add GSI:** Create index for the query pattern
2. **Composite Keys:** Use status#timestamp or type#id patterns
3. **Sparse Indexes:** Index only items matching criteria
4. **Denormalization:** Duplicate data to enable Query access
5. **External Search:** Use OpenSearch/Elasticsearch for complex queries

**Ad-Hoc Queries:**

- DynamoDB requires known access patterns
- Use RDS for flexible querying needs
- Use Athena for exploratory data analysis

### Data That Shouldn't Be in DynamoDB

**Large Binary Files:**

- Images, videos, PDFs → Store in S3
- Keep S3 object key in DynamoDB
- Use S3 presigned URLs for access

**Frequently Changing Large Items:**

- High write costs for large items
- Consider breaking into smaller items
- Use S3 for large mutable objects

**Audit Logs:**

- Long retention requirements → S3 + Athena
- Cost-effective storage and querying
- DynamoDB for recent logs, S3 for archives

**Data Requiring Complex Aggregations:**

- Use purpose-built analytics services
- Export to S3 and query with Athena
- Use DynamoDB for operational queries only

## Output Format Template

Generate all table designs using this structured format:

---

# DynamoDB Table Design

## Executive Summary

[2-3 sentences describing the design approach, key decisions, and primary optimization goals]

**IMPORTANT DISCLAIMER:** This design document contains performance and cost estimates based on AWS documentation, industry benchmarks, and theoretical calculations. All estimates must be validated through load testing and production monitoring before making capacity or budget commitments.

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

## Implementation Code

### CDK (TypeScript)

```typescript
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cdk from 'aws-cdk-lib';

export class DynamoDBStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'Users',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.NUMBER,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

      // Enable Point-in-Time Recovery for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },

      // Enable encryption at rest
      encryption: dynamodb.TableEncryption.AWS_MANAGED,

      // Enable DynamoDB Streams (if needed)
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,

      // Enable TTL (if needed)
      timeToLiveAttribute: 'expiresAt',

      // Removal policy (use RETAIN for production)
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add Global Secondary Index
    table.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: {
        name: 'email',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // Add another GSI with INCLUDE projection
    table.addGlobalSecondaryIndex({
      indexName: 'StatusTimeIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'lastLogin',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['email', 'profile'],
    });
  }
}
```

### CloudFormation (YAML)

```yaml
Resources:
  UsersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: Users
      BillingMode: PAY_PER_REQUEST

      AttributeDefinitions:
        - AttributeName: userId
          AttributeType: S
        - AttributeName: createdAt
          AttributeType: N
        - AttributeName: email
          AttributeType: S
        - AttributeName: status
          AttributeType: S
        - AttributeName: lastLogin
          AttributeType: N

      KeySchema:
        - AttributeName: userId
          KeyType: HASH
        - AttributeName: createdAt
          KeyType: RANGE

      GlobalSecondaryIndexes:
        - IndexName: EmailIndex
          KeySchema:
            - AttributeName: email
              KeyType: HASH
          Projection:
            ProjectionType: KEYS_ONLY

        - IndexName: StatusTimeIndex
          KeySchema:
            - AttributeName: status
              KeyType: HASH
            - AttributeName: lastLogin
              KeyType: RANGE
          Projection:
            ProjectionType: INCLUDE
            NonKeyAttributes:
              - email
              - profile

      # Enable Point-in-Time Recovery
      PointInTimeRecoverySpecification:
        PointInTimeRecoveryEnabled: true

      # Enable encryption at rest
      SSESpecification:
        SSEEnabled: true
        SSEType: KMS

      # Enable DynamoDB Streams
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES

      # Enable TTL
      TimeToLiveSpecification:
        AttributeName: expiresAt
        Enabled: true

      Tags:
        - Key: Environment
          Value: Production
        - Key: Application
          Value: UserManagement
```

### Example Queries (AWS SDK v3 - TypeScript)

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// Define types
interface User {
  userId: string;
  email: string;
  createdAt: number;
  status: string;
  profile?: Record<string, any>;
  lastLogin?: number;
}

interface CreateUserData {
  userId: string;
  email: string;
  profile?: Record<string, any>;
}

// Get user by ID (Primary Key)
async function getUserById(userId: string): Promise<User | undefined> {
  const command = new GetCommand({
    TableName: 'Users',
    Key: { userId },
  });

  const response = await docClient.send(command);
  return response.Item as User | undefined;
}

// Get user by email (GSI)
async function getUserByEmail(email: string): Promise<User[]> {
  const command = new QueryCommand({
    TableName: 'Users',
    IndexName: 'EmailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email,
    },
  });

  const response = await docClient.send(command);
  return (response.Items || []) as User[];
}

// List active users by last login (GSI with range query)
async function getActiveUsersByLastLogin(sinceTimestamp: number): Promise<User[]> {
  const command = new QueryCommand({
    TableName: 'Users',
    IndexName: 'StatusTimeIndex',
    KeyConditionExpression: '#status = :status AND lastLogin > :since',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': 'active',
      ':since': sinceTimestamp,
    },
  });

  const response = await docClient.send(command);
  return (response.Items || []) as User[];
}

// Create new user
async function createUser(userData: CreateUserData): Promise<User> {
  const newUser: User = {
    userId: userData.userId,
    email: userData.email,
    createdAt: Date.now(),
    status: 'active',
    profile: userData.profile,
  };

  const command = new PutCommand({
    TableName: 'Users',
    Item: newUser,
    ConditionExpression: 'attribute_not_exists(userId)', // Prevent overwrites
  });

  await docClient.send(command);
  return newUser;
}

// Update user status
async function updateUserStatus(userId: string, newStatus: string): Promise<User> {
  const command = new UpdateCommand({
    TableName: 'Users',
    Key: { userId },
    UpdateExpression: 'SET #status = :status, lastLogin = :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':now': Date.now(),
    },
    ReturnValues: 'ALL_NEW',
  });

  const response = await docClient.send(command);
  return response.Attributes as User;
}
```

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

---

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

---

## Quality Gate

**CRITICAL (must fix):**

- Hot partition risk — access patterns concentrate writes on a single partition key value
- Missing GSI for a required query pattern
- No TTL strategy for time-bounded data

**IMPORTANT (should fix):**

- Capacity mode (on-demand vs provisioned) not justified
- Missing item size estimates for capacity planning
- No backup and recovery strategy documented

**SUGGESTION:**

- Could add DynamoDB Streams configuration for event-driven patterns
- Could document cost estimates for projected load

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
