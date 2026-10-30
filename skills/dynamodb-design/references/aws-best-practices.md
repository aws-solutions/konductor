# DynamoDB AWS best practices

Read this when choosing keys and indexes; read only the subsections for features the design uses.

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
