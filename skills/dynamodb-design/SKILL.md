---
name: dynamodb-design
description: Designs DynamoDB tables and GSIs from access patterns and reviews a design for hot partitions and unsharded keys. Use when designing or reviewing a DynamoDB data model, its keys, GSIs, capacity mode or alarms.
version: 2.0.0
tags: [skill, dynamodb, database-design, nosql, data-modeling, aws, checker]
---

# DynamoDB Design

## Overview

Turns access patterns into a table, key and index design, then checks it with the quality gate at the end. The same gate reviews a design someone else wrote. For depth this skill does not carry, see the pointer at the end.

## 1. Access patterns first

List every access pattern before choosing a key. For each one, record:

| # | Access pattern | Operation | Key condition | Frequency (peak/s) | Item size |
| --- | --- | --- | --- | --- | --- |
| AP1 | Customer lists orders, newest first | Query | `PK = CUST#<id>`, `SK begins_with ORDER#`, descending | 200 reads | 2 KB |

Every pattern needs a key condition on the table or a GSI. A pattern that only a Scan or a `FilterExpression` can serve is a design gap, not a pattern.

## 2. Key design

- **Partition key cardinality.** Choose an attribute with thousands to millions of values (customer, order, device). Status, type, category, a boolean, or a date has a handful of values and puts the writes for each value on one partition.
- **Per-partition ceiling.** Each partition serves up to 3,000 strongly consistent 4 KB reads (6,000 eventually consistent) and 1,000 1 KB writes per second. The base table and each GSI have their own partitions and their own ceilings. Adaptive capacity and burst capacity absorb uneven traffic and short spikes but do not lift the per-partition ceiling.
- **Hot key check.** For each partition key value, estimate peak writes per second. Above about 1,000 writes per second for one value, the key needs write sharding (section 3) or a different key.
- **Composite sort keys.** Put the query's equality parts first and the range part last: `ORDER#<createdAt>#<orderId>` sorts by time and stays unique. Use `begins_with` for hierarchies (`TENANT#<id>#USER#<id>`).

Confirm the current ceilings with `aws___search_documentation` ("DynamoDB partition throughput limit") before quoting them in a design.

## 3. GSIs

- **Projection.** `KEYS_ONLY` when the caller fetches the full item anyway, `INCLUDE` for the attributes the query returns, `ALL` only when the query needs every attribute. Each projected byte is stored and written again.
- **Sparse indexes.** An item without the GSI key attributes is not indexed. Use this for "only the items in state X" patterns.
- **Back-pressure.** GSIs update asynchronously. When a GSI partition cannot take the update, DynamoDB throttles the write to the base table, even when the base table has capacity. The throttling exception names the GSI in `ResourceArn`. A low-cardinality GSI partition key is the usual cause.
- **Write sharding a low-cardinality key.** Append a shard number to the key, write to one shard, and query every shard in parallel. Pick the shard count N so that peak writes per second for one key value, divided by N, stays well under 1,000. Use a calculated shard (`hash(orderId) % N`) when one item must be found again by its key; use a random shard when only fan-out reads happen.

### Worked example: orders by status for a day

Support lists every order in a given status for a day. A GSI on `status#day` would put all of today's `PENDING` writes on one GSI partition, and at peak that is 4,000 writes per second.

| Attribute | Value |
| --- | --- |
| `GSI1PK` | `STATUS#PENDING#2026-11-11#<shard>` with `shard = hash(orderId) % 10` |
| `GSI1SK` | `<createdAt>#<orderId>` |
| Projection | `INCLUDE` the fields the support list shows |

Each shard takes about 400 writes per second. To read, issue ten `Query` calls in parallel (`GSI1PK = STATUS#PENDING#2026-11-11#0` through `#9`), merge the pages by `GSI1SK`, and paginate each shard with its own `LastEvaluatedKey`. A status change rewrites `GSI1PK` and moves the item under the new status's key; that costs one GSI delete and one GSI put.

## 4. Single table or several

Use one table when queries read related entities together (a customer and its orders) and the access patterns are known. Use separate tables when entities need different backup, encryption, retention or capacity settings, or when their access patterns never meet. Do not merge tables only to have fewer of them.

## 5. Capacity

- **On-demand** is the default and fits most workloads, including new and spiky ones.
- **Provisioned** fits steady, predictable traffic, with auto scaling, and costs less at a stable high rate. Switching from provisioned to on-demand is limited to four times in a rolling 24 hours; switching back is allowed at any time.
- **Price.** When a design or review states prices, verify them against the live Price List (through aws-mcp, see the `cost-estimation` skill) or the [DynamoDB pricing page](https://aws.amazon.com/dynamodb/pricing/), and correct any that are wrong. When no lookup is possible, use these reference rates and mark them unverified: on-demand $0.625 per million write request units and $0.125 per million read request units, US East (N. Virginia), Standard table class, checked 2026-11. Any rate written into a design names its Region, table class and the date it was checked.
- Size items: on-demand charges one write unit per 1 KB written and one read unit per 4 KB strongly consistent read (half for eventually consistent), rounded up per item, and every GSI write is charged again.

## 6. Current facts that change a design

- **Throttle alarms.** Alarm on `ReadThrottleEvents` and `WriteThrottleEvents` with both the `TableName` and `GlobalSecondaryIndexName` dimensions for each GSI; the `TableName` dimension alone leaves GSIs out. Add `WriteKeyRangeThroughputThrottleEvents` and `ReadKeyRangeThroughputThrottleEvents` to catch hot-partition throttling. A percent-of-provisioned alarm means nothing on an on-demand table.
- **Global tables.** Choose the consistency mode at creation; it cannot change. MREC (the default) replicates asynchronously, last writer wins, RPO above zero. MRSC gives strongly consistent reads in every Region and an RPO of zero, at higher write latency, with no TTL, LSIs or transactions; conflicting writes fail with `ReplicatedWriteConflictException`. MRSC needs exactly three Regions (three replicas, or two replicas and a witness) chosen from the Regions that support it. Do not state a specific Region combination or witness placement as fact; check the global tables documentation for the current supported Regions and test latency in the Regions you pick.
- **TTL.** The attribute is a Number in epoch seconds. Expired items are typically deleted within a few days and stay readable until then, so filter them out of reads.
- **Transactions.** Up to 100 actions and 4 MB per request, atomic in one Region only. GSIs update after the commit, so a GSI read can show part of a transaction.
- **DAX.** Caches eventually consistent reads only. Strongly consistent reads and `TransactGetItems` pass through. Writes that bypass DAX leave cached items stale until their TTL.
- **Backup.** Enable point-in-time recovery (1 to 35 days) and deletion protection on production tables.

## 7. Quality gate

Run this gate on every design, your own or one under review.

**CRITICAL (must fix):**

- Hot partition: a base-table partition key on a date, timestamp or low-cardinality attribute, or any key value expected above about 1,000 writes per second, with no sharding
- Unsharded low-cardinality GSI partition key (status, type, day, boolean) on items that take production writes; GSI back-pressure will throttle base-table writes
- An access pattern with no key condition, served by Scan or `FilterExpression`

**IMPORTANT (should fix):**

- GSI throttle alarms missing the `GlobalSecondaryIndexName` dimension, or no throttle alarms at all
- Capacity mode not justified, or item sizes not estimated
- `ALL` projection where the query returns a few attributes
- Time-bounded data with no TTL; production table without PITR or deletion protection
- A hard-coded price with no Region and date, or a cross-Region strong-consistency need not matched to MRSC and its limits

**SUGGESTION:**

- Could use a sparse index for a state-filtered pattern
- Could add Streams for event-driven consumers (idempotent, with a DLQ)
- Could price the design with `cost-estimation`

## 8. Output format

1. **Access patterns** table (section 1), every row mapped to a key condition.
2. **Table**: name, `PK`, `SK`, capacity mode with its reason, TTL attribute, PITR, deletion protection.
3. **Item types**: one row per entity with its `PK`, `SK` and GSI key values.
4. **GSIs**: name, partition and sort key, shard count, projection, and the patterns each serves.
5. **Access-pattern map**: pattern → table or GSI → exact key condition → operation.
6. **Alarms**: metric, dimensions, threshold.
7. **Quality gate** results, CRITICAL → IMPORTANT → SUGGESTION.

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.

## Going deeper

For Streams consumers, backup and restore, security review, vector indexes, zero-ETL and the cost calculator, load the AWS MCP server's `amazon-dynamodb` skill with `aws___retrieve_skill`, or through `find-aws-skills`. It is large: retrieve the sections you need by name rather than reading it whole. Keep this skill's quality gate and output format either way.
