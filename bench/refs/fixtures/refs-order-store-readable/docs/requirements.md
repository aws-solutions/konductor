# Order tracking service: data access

## Entities

- Order: orderId, customerId, warehouseId, status (placed, picked, shipped, delivered, cancelled), carrier, trackingNo (optional, unique across all orders), couponCode (optional), createdAt, updatedAt. About 2 KB each.
- OrderEvent: orderId, eventId, eventTime, type, detail. One per status change or parcel scan. An order has about 12 events.

## Volumes

- 90 million orders, growing 2 percent a month.
- 70 percent of reads touch orders created in the last 14 days.
- Most customers have under 50 orders. Warehouses number about 40.
- Events arrive all day and peak at 2,400 writes a second for the whole service.

## Access patterns

| ID | Pattern | Rate | Notes |
|----|---------|------|-------|
| AP1 | Get one order by orderId | 1,500 reads/s | p99 under 10 ms |
| AP2 | List a customer's orders, newest first, 20 per page | 300 reads/s | |
| AP3 | Get an order with its events in time order | 400 reads/s | |
| AP4 | Append an order event | 2,400 writes/s at peak | |
| AP5 | List all events of one calendar day in time order, paged | 20 reads/s | hourly export job and the ops screen |
| AP6 | List the orders of one warehouse that are picked but not yet shipped, oldest first | 150 reads/s | |
| AP7 | Find the order for a tracking number | 80 reads/s | at most one match |
| AP8 | List the orders one carrier shipped on a given day | 10 reads/s | |
| AP9 | Find the orders that used a coupon code | about 5 a day | support staff, no latency target |

Creating orders (120 writes/s) and updating an order (300 writes/s) also happen all day.

## Constraints

- The team runs on a managed key-value database (DynamoDB). No other database is available for the primary data.
- Reads must be strongly consistent for AP1 and AP3.
- The design follows the team's DynamoDB standards.
