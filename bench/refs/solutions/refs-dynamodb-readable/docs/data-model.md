# Order tracking: DynamoDB data model

## Standards applied

- Write sharding: a shard suffix in the range 1 to 200, calculated as `hash(eventId) % 200 + 1`, so the shard can be rebuilt from the event.
- Index count: at most 5 GSIs per table. This design uses 4.
- Every production query is a GetItem or a Query. No Scan.

## Table `orders`

| Item type | Partition key (PK) | Sort key (SK) | Main attributes |
|-----------|--------------------|---------------|-----------------|
| Order | `ORDER#<orderId>` | `META` | customerId, warehouseId, status, carrier, trackingNo, couponCode, createdAt, updatedAt |
| OrderEvent | `ORDER#<orderId>` | `EVT#<eventTime>#<eventId>` | type, detail, day, dayShard |
| Tracking lookup | `TRACK#<trackingNo>` | `META` | orderId |

Capacity mode: on-demand. Traffic is spiky (2,400 event writes a second at peak, far less at night), the mix changes with the season, and we have no history to size provisioned throughput. Revisit with provisioned capacity and auto scaling once a quarter of traffic is known.

## Indexes

| Index | Partition key | Sort key | Holds | Projection |
|-------|---------------|----------|-------|------------|
| GSI1 customer | `CUST#<customerId>` | `createdAt` | orders only | INCLUDE status, carrier |
| GSI2 warehouse (sparse) | `WH#<warehouseId>` | `createdAt` | only orders in status picked | KEYS_ONLY |
| GSI3 carrier day | `CARRIER#<carrier>#<shippedDay>` | `shippedAt` | shipped orders | KEYS_ONLY |
| GSI4 event day | `DAY#<day>#<shard>` | `eventTime` | events only | INCLUDE type |

GSI2 is sparse: the attribute `GSI2PK` is set when the order becomes picked and removed when it ships, so the index only holds work in progress. There are 4 GSIs, inside the limit of 5.

## Access patterns

| ID | Served by | Key condition |
|----|-----------|---------------|
| AP1 | table, GetItem with ConsistentRead | PK = `ORDER#<id>`, SK = `META` |
| AP2 | GSI1, Query, ScanIndexForward=false, Limit 20 | GSI1PK = `CUST#<customerId>` |
| AP3 | table, Query with ConsistentRead | PK = `ORDER#<id>` (the order item and its events, in time order) |
| AP4 | table, PutItem | PK = `ORDER#<id>`, SK = `EVT#...`; also sets `day` and `dayShard` |
| AP5 | GSI4, one Query per shard, merged by eventTime | GSI4PK = `DAY#<day>#<n>` for n = 1 to 200 |
| AP6 | GSI2, Query ascending | GSI2PK = `WH#<warehouseId>` |
| AP7 | table, GetItem on the lookup item, then GetItem on the order | PK = `TRACK#<trackingNo>` |
| AP8 | GSI3, Query | GSI3PK = `CARRIER#<carrier>#<day>` |
| AP9 (coupon search) | no index | export to S3 and query with Athena, or a filtered query run by a scheduled job |

## Write sharding for AP4 and AP5

All events of a day would land on one key, and 2,400 writes a second is more than the 1,000 write units a single partition takes. The event-day index therefore spreads a day over 200 shard suffixes (`DAY#2026-03-13#117`). At peak each shard takes about 12 writes a second.

Cost: AP5 has to read all 200 shards and merge by time. The export job runs the 200 queries in parallel; the ops screen reads a time window and stops early. We accept this because AP5 runs 20 times a second at most and AP4 cannot be slowed down.

## Decisions and trade-offs

- AP7 uses a lookup item instead of a GSI. A conditional put with `attribute_not_exists(PK)` in a transaction with the order write enforces that a tracking number is unique, which a GSI cannot do, and it saves a fifth index.
- AP9, the coupon search, gets no GSI. Support runs it about 5 times a day and has no latency target, which does not justify the doubled write cost of an index.
- Rejected: one table per entity. It would cost two reads for AP3 and gives up the single-partition read.
- Rejected: a date-only partition key for events. It makes a hot partition at peak.
- Rejected: a Scan for AP9. It reads 90 million items and gets worse as the table grows.

## Risks

- A hot day shard is unlikely with a hash suffix, but a bug that sets every `dayShard` to the same value would throttle writes. Add an alarm on throttled write events.
- Each event is written to the table and to GSI4, so event writes cost double.
- 70 percent of reads touch orders from the last 14 days. Consider a TTL or an archive of delivered orders after 180 days, and a table class for infrequent access if cost grows.
