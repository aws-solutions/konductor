# DynamoDB AWS best practices

Read this when choosing keys and indexes. Always read the core subsections that `SKILL.md` lists under AWS Best Practices; read a feature subsection only when the design uses that feature.

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

