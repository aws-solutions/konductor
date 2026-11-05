# Data model: support ticket service (DynamoDB)

Source: `docs/access-patterns.md`. One table, `Tickets`, plus two global secondary indexes. Keys are strings with a type prefix.

## Table `Tickets`

| Item type | PK | SK | Other attributes |
|-----------|----|----|------------------|
| Ticket | `TICKET#<ticketId>` | `META` | customerId, subject, status, priority, assignedAgent, externalRef, createdAt, updatedAt |
| Comment | `TICKET#<ticketId>` | `COMMENT#<createdAt ISO>#<commentId>` | author, body, createdAt |
| Audit entry | `TICKET#<ticketId>` | `AUDIT#<at ISO>#<n>` | actor, action |
| External reference | `EXTREF#<externalRef>` | `META` | ticketId |

Comments are separate items in the ticket's item collection. They are not a list attribute on the ticket: an item is limited to 400 KB, and 10,000 comments of 2 KB would be about 20 MB. Separate items also let each comment be written on its own at 600 writes/s without rewriting the ticket.

## Indexes

| Index | Partition key | Sort key | Projection | Items |
|-------|---------------|----------|------------|-------|
| `GSI1-customer` | `customerId` | `createdAt` | KEYS_ONLY plus subject, status | tickets only |
| `GSI2-agent-queue` | `assignedAgent` | `priorityCreated` = `<priority>#<createdAt>` | subject, customerId | open tickets with an agent only (sparse) |

`GSI2-agent-queue` is sparse: `assignedAgent` and `priorityCreated` are written only while a ticket is open and assigned, and removed when it is solved or closed. An agent's queue (at most 400 items) is one Query.

## Access patterns

| ID | Served by | Key condition |
|----|-----------|---------------|
| AP1 | `Tickets`, GetItem with ConsistentRead | PK = `TICKET#id`, SK = `META` |
| AP2 | `GSI1-customer`, Query, ScanIndexForward=false, Limit 25, paginate with LastEvaluatedKey | customerId = :c |
| AP3 | `GSI2-agent-queue`, Query | assignedAgent = :a; sort key ascending after storing priority as `1` = highest, so highest priority comes first, then oldest first |
| AP4 | `Tickets`, Query with ConsistentRead, ScanIndexForward=false, Limit 50 | PK = `TICKET#id` and SK begins_with `COMMENT#`; older pages use LastEvaluatedKey |
| AP5 | `Tickets`, GetItem on the lookup item, then GetItem on the ticket | PK = `EXTREF#ref`, SK = `META` |
| AP6 | Counters, not a query | see below |
| AP7 | `Tickets`, TransactWriteItems | see below |

A GSI read is eventually consistent. AP2 and AP3 allow that. AP1 and AP4 read the base table, so they can be strongly consistent as required.

## External reference uniqueness (AP5)

A GSI cannot enforce uniqueness. Creating a ticket with an externalRef uses a transaction that puts the ticket and puts the `EXTREF#ref` item with `attribute_not_exists(PK)`. A duplicate reference fails the whole create.

## Dashboard (AP6)

A Scan of 400 million items is far too slow and costly. A GSI on status would have four partition key values, each holding about 100 million items, which concentrates traffic on four partitions. Instead, a Lambda reads the table's change stream and updates one counter item per status (`STATS#status`), batched by the minute. The dashboard reads four items. A few minutes of delay is within the requirement. An export to an analytics store is the fallback if more dimensions are needed later.

## Close a ticket (AP7)

TransactWriteItems with two actions: Update the ticket (`SET status = :closed REMOVE assignedAgent, priorityCreated` with condition `status <> :closed`) and Put the audit entry (`attribute_not_exists(SK)`). Both succeed or neither does; a ticket that is already closed makes the transaction fail. Transactions use double the write capacity, which is fine at 50 writes/s.

## Capacity

On-demand mode. Reads reach 2,000/s for AP1 plus 400/s for AP4, writes about 1,000/s combined (150 creates, 600 comments, 200 updates, 50 closes), and traffic is bursty across the day. On-demand removes capacity planning for a team that needs a latency target and has no steady baseline yet. A partition serves up to 3,000 read units and 1,000 write units per second. The 200,000-ticket customer is the key to watch: AP2 for that customer reads from one GSI partition key. At 500 reads/s across all customers this stays under the limit unless that single customer takes most of the traffic. If that happens, shard the GSI key as `customerId#<0..3>` and merge on read. Revisit provisioned capacity with auto scaling once the traffic is steady and the cost matters.

## Lifecycle and retention

80 percent of traffic touches tickets under 30 days old, and tickets are kept for 7 years. Put a `ttl` on comment and audit items of tickets closed for 90 days after they are copied to cold storage (S3 through the stream), and consider the Standard-IA table class for the table because storage dominates cost at 1.2 TB.

## Alternatives rejected

- A GSI on status for the dashboard: four values means hot partitions and a 100-million-item scan per value.
- Comments as a list attribute on the ticket: breaks at the 400 KB item limit and rewrites the whole ticket on each comment.
- One table per entity: needs several round trips for AP4 and cannot join the ticket and its comments in one Query.
- A relational database: not available for the primary data in the constraints.

## Risks

- The sparse index depends on removing the attributes when a ticket closes; a missed update leaves stale queue entries.
- The stream consumer for counters must be idempotent; a retry would double count.
- Hot customer key as described above.
