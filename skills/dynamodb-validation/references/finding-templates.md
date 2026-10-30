# Finding templates

Read this when writing a finding; copy the template for its severity.

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
