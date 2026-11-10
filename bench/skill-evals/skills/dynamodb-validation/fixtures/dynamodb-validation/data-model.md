# Orders table design (v1)

Service: order-tracking for a marketplace. Launch traffic estimate: 2,000 order writes/sec
at peak (holiday), 8,000 reads/sec. About 40M orders/year, kept forever.

## Table: Orders

| Attribute | Type | Notes |
|-----------|------|-------|
| status (PK) | S | one of PENDING, PAID, SHIPPED, DELIVERED, CANCELLED |
| createdAt (SK) | S | ISO-8601 timestamp |
| orderId | S | UUID |
| customerId | S | |
| sellerId | S | |
| lineItems | L | up to 200 items |
| receiptPdf | B | base64 PDF receipt, typically 250-380 KB |
| sessionToken | S | checkout session, only valid for 30 minutes |

Capacity: PROVISIONED, 2,500 WCU / 9,000 RCU on the base table.

## GSI1 - by customer

- PK: customerId, SK: createdAt
- Projection: ALL
- Capacity: 200 WCU / 500 RCU

## Access patterns

| # | Pattern | Frequency | How |
|---|---------|-----------|-----|
| AP1 | Get order by orderId | 5,000/sec | Scan with FilterExpression orderId = :id |
| AP2 | List a customer's orders, newest first | 2,000/sec | Query GSI1 |
| AP3 | List all PENDING orders older than 1 hour (ops sweeper) | 1/min | Query PK=PENDING, SK < now-1h |
| AP4 | List a seller's orders by day | 300/sec | not designed yet |
| AP5 | Admin page: list all orders | 20/sec | Scan |

After `PutItem`, the checkout page immediately calls Query on GSI1 to show the order
in the customer's history.

## Operations

Encryption: not specified. Backups: none planned yet. No TTL. No CloudWatch alarms yet.
