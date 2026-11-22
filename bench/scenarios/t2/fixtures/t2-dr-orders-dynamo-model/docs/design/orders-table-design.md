# Orders service single-table design

**Status:** Proposed for migration review  
**Owner:** Orders Platform  
**Last updated:** 2025-02-18  
**Decision requested:** approve the table shape and migration plan for the March development cutover

## 1. Purpose and decision

This document describes the DynamoDB table that will replace the Orders service's order and order-status tables. The service accepts checkout orders, returns order details to customers, and supplies status information to the fulfillment console. We will keep the public API stable while changing persistence behind the repository interface.

The proposal uses one table named `orders-prod` and a small set of item types. A single table keeps transactional writes local to one DynamoDB resource and gives the team one backup and monitoring surface. The design targets the February traffic forecast and the March migration window. Priya Nair owns the implementation, with the data platform group providing the table and alarms.

The design is ready to approve because each required read has a documented path, the cost model fits the monthly allocation, and the migration can be rolled out without changing clients. Items use string keys so the repository can add new entity types later without a second table.

### 1.1 Goals and non-goals

The goals are to preserve order creation and lookup behavior, keep p95 reads below 90 ms, support the fulfillment console's status view, and make a new order visible to the checkout response immediately. The table must support the projected 2.5x order growth over 18 months without a second persistence service. The migration must allow a quick switch back to the relational repository during the first release.

The first release does not include customer-facing analytics, arbitrary search, or a new reporting API. Reporting will read the table directly until the analytics group finishes its lake export. Historical orders remain available for the service's seven-year retention period.

### 1.2 Design principles

The repository will own key construction and hide DynamoDB expressions from HTTP handlers. All writes will include the order version and updated timestamp. The application will use the AWS SDK v3 document client with native JavaScript values. We will use on-demand capacity during the migration and review a provisioned plan after two weeks of production observations.

## 2. Current service and boundaries

The current service stores an order row, an order-line row for each product, and a status history row in PostgreSQL. The API has separate endpoints for a customer's recent orders, a single order, and the fulfillment queue. The migration repository maps those rows to DynamoDB items while preserving response field names.

The service owns customer order data and fulfillment state. The catalog service remains the source of product names and prices. The reporting team receives order facts but does not write to the table. Customer identity is supplied by the gateway as an authenticated customer ID; the Orders service does not accept a customer ID from a free-form query parameter for customer-scoped endpoints.

### 2.1 Request flows

Checkout validates the cart with Catalog, creates an order, and returns the new order ID. The order write includes the customer ID, currency, totals, shipping summary, and the current status. Fulfillment workers then update status as payment, packing, and shipment events arrive. A worker may receive the same event more than once when its visibility timeout expires.

The customer order-history endpoint returns the newest orders first, with a cursor and a default page size of 20. The current endpoint supports a customer with many years of history without returning the full history in one response. The fulfillment console asks for orders in a status, sorted by update time, and refreshes that view every 30 seconds.

### 2.2 Consistency and failure behavior

Checkout reads the newly written order before sending its response, so the create path uses a strongly consistent read where a follow-up read is needed. The history page may use an eventually consistent read. Status events are retried by the queue consumer and carry an event ID. The existing relational implementation rejects an already applied event ID without changing the status again.

The repository returns a typed not-found result for an absent order. Transient DynamoDB errors are retried by the SDK with the standard retry mode. HTTP handlers do not retry a write after the repository returns an unknown outcome; the caller instead polls the order by ID. The migration must preserve these behavior choices.

## 3. Table and item model

All entities live in `orders-prod`. Every item has `pk`, `sk`, `entityType`, `createdAt`, and `updatedAt`. Order attributes use the same names as the API response where that does not create a reserved-word conflict. Timestamps are ISO-8601 UTC strings, and monetary amounts are integer minor units.

### 3.1 Order item shape

An order item has `entityType: "ORDER"`, the order identifier, the authenticated customer ID, order state, totals, currency, shipping summary, and timestamps. Its sort key contains the order identifier so a direct lookup can fetch the complete order. The repository writes the complete item in one PutItem operation and uses a condition that the order key does not already exist.

The order record also stores `statusVersion`, initially zero, for optimistic version tracking. A status update writes `status`, `statusUpdatedAt`, and the next version after checking the current version. A status history item is written separately after the main update so the console can show the last transition without reading the whole history.

### 3.2 Primary key and order placement

The primary key is derived from the calendar date on which the order was created. An order created on 2025-02-18 uses `pk = ORDER#2025-02-18` and `sk = ORDER#<orderId>`. The date is taken from the service clock in UTC, which keeps a day's order items together and makes operational inspection straightforward. A query for a day's orders uses the partition key and a sort-key prefix.

Traffic forecasts show a launch peak with most order writes assigned to the current UTC date partition. The table is on-demand, so DynamoDB will scale capacity as the service sends requests. The team expects the date grouping to keep query planning simple and believes the launch traffic is within the table's normal operating range.

For a date boundary, the application uses the UTC date captured when checkout begins. A retry that crosses midnight retains its original date and order ID. The migration backfill uses the source row's creation date, so historical items follow the same key rule.

### 3.3 Customer history access

The customer-history repository method accepts `customerId`, `before`, and `limit`. The implementation uses the order item layout, retains records matching the customer, and sorts the retained records by `createdAt` descending before producing the cursor. A page is complete when it has 20 matching orders. This avoids adding a customer-specific key shape and keeps the primary item layout uniform.

The method is used by the `GET /v1/customers/me/orders` endpoint. The endpoint default is 20 records and the API caps the requested page at 50. The repository stops collecting after the page is full, but it keeps the DynamoDB `LastEvaluatedKey` in the opaque cursor so a caller can request the next page. The implementation is shared by the migration repository and the relational compatibility tests.

### 3.4 Line items and order size

Line items are stored in the order item as a list under `lines`. Each list entry contains SKU, catalog version, quantity, unit price, discount amount, and the product title captured at purchase time. Keeping lines beside the order makes the normal order-details read one GetItem and lets checkout write the order atomically.

The API accepts up to 500 lines per order. A special business customer has requested support for larger bulk orders next quarter. The repository keeps the line list on the order item and relies on the document client serializer to write the complete order.

A detail response includes every line, while list responses project only order summary fields. The migration verifier compares the line count and total amount between the source row set and the new order item. Product titles are copied at checkout, so later catalog changes do not alter an order response.

### 3.5 Status summary item

The fulfillment view uses a summary item for each status and calendar day. Its key is `pk = STATUS#<date>` and `sk = COUNT#<status>`. The item contains `orderCount` and `lastEventAt`. Fulfillment workers update the counter when an order changes status, while the console reads these items for its small summary tiles.

The worker applies the status delta to the summary count and persists the updated item with the new `lastEventAt`. If no summary item exists, the worker starts the count at one. The summary item contains the count and timestamp, while the order update and summary persistence remain separate operations.

The main order status is updated before the summary item. A reconciliation job runs at 03:00 UTC and compares summary values with orders from the previous day. It records a metric when the values differ and rewrites the summary with the computed count.

## 4. Secondary access paths

The table has one global secondary index for fulfillment. Index names are kept in configuration so a future table replacement does not require changes to handler code. GSI writes are asynchronous and the console displays the index's last refresh timestamp beside the result count.

### 4.1 Fulfillment status index

`GSI1` uses `gsi1pk = STATUS#<status>` and `gsi1sk = <updatedAt>#<orderId>`. A fulfillment query supplies a status and a time window, then requests results in descending order. The projected response needs `orderId`, `customerId`, and `updatedAt`; the console fetches the full order only when an operator opens a row.

The index uses an order-shaped projection so a future console column can be added without changing the index definition or adding a table read. The current cost estimate includes the GSI's write units and storage together with the base table. The table and index use the same on-demand billing mode.

### 4.2 Query behavior and pagination

All queries use a limit and return a cursor. The status query caps a page at 100 rows and the handler stops when the time-window boundary is reached. A stale index result is acceptable for the console because the operator can open the order for the latest status. Customer details never come from the GSI.

A missing index result is treated as an empty page. The console polls again after 30 seconds and shows the last refresh timestamp. The repository does not perform a fallback base-table read for the fulfillment query.

## 5. Capacity, cost, and limits

DynamoDB on-demand capacity is the default for the first release. The table starts with point-in-time recovery enabled and server-side encryption using the AWS owned key. Application logs include request IDs, table operation names, and consumed capacity when the debug flag is enabled.

### 5.1 Traffic and item assumptions

The February forecast is 1,800 peak order writes per second, 7,000 order-detail reads per second, 2,400 customer-history requests per second, and 180 fulfillment queries per second. Average order size is 24 KB including lines, and the average history page contains 20 summaries. Ninety-day growth is estimated at 18%, with a 2.5x order count over 18 months.

Checkout writes one order item and one status update. Fulfillment writes the order state and the summary item. Customer history reads pages by the repository method in section 3.3. These assumptions feed the cost spreadsheet and the launch load test.

### 5.2 Monthly cost model

The working monthly allocation is 7,500 USD for storage, requests, backups, and exports. The cost spreadsheet uses 1,800 peak writes per second for 12 launch hours each month, 500 average writes per second for the remaining hours, and 7,000 detail reads per second during the daytime. It estimates 2,100 USD for table requests, 900 USD for storage and backups, and 1,300 USD for the fulfillment index and its storage.

The model includes 15% headroom and excludes the temporary dual-write period. It treats the index as a separate request stream but uses the same item-size distribution for base and index writes. Finance reviews the estimate each month after the usage report arrives.

### 5.3 Item and response limits

The repository sets a 50-item page limit for customer history and a 100-item limit for fulfillment. The API gateway caps JSON responses at 6 MB. A single order detail response is expected to remain below that cap under the current 500-line API limit. The application rejects an order when the request body exceeds 2 MB.

The table uses the service's seven-year retention requirement. The migration does not add a TTL attribute because historical records must remain queryable for customer support and reporting. Archive export is owned by the data platform group and is outside this table decision.

## 6. Reporting and exports

The reporting team needs hourly order counts by merchant, day, currency, and final status, plus a daily order-line extract for finance. They currently run SQL against a read replica and expect the first DynamoDB version to keep the same hourly freshness. The reporting role is read-only and is separate from the Orders service role.

### 6.1 Hourly report job

The report job runs at five minutes past every hour and traverses the order records in `orders-prod`. It filters out status summaries and history items, then groups the remaining records in the report worker. The same traversal is used for every dimension because merchant and final-status dimensions change during an order's life and the reporting team wants one implementation for every dimension.

The job uses the SDK paginator with a page size of 1 MB and writes a temporary aggregate file to the reporting bucket. It starts each run from the first page rather than retaining a high-water mark. If a page fails, the worker retries that page and restarts the report when the retry budget is exceeded. Reports are marked complete only after the final page is reached.

### 6.2 Line extract

The daily extract includes one row per line with order ID, merchant ID, SKU, quantity, amount, and order timestamps. The job reads the same order items as the hourly report and expands the `lines` list. It retains seven years of files in the reporting bucket. A checksum and row count are written beside each completed file.

The report worker assumes a stable order item during a page read. It records the run start time and includes orders updated after that time in the next run. The reporting team accepts small differences between hourly and daily files while late status events are being processed.

### 6.3 Reporting budget

The estimate assumes one complete traversal per hour at the current table volume and carries the same fixed read allocation forward as data grows. Report freshness and the hourly schedule stay unchanged.

The reporting role uses the same on-demand table billing mode as application reads. Report activity is tagged with `workload=reporting` so the data platform group can compare actual consumption with the allocation.

## 7. Migration and rollout

Migration has three stages. First, the repository writes to PostgreSQL and DynamoDB in development while a verifier compares order counts and totals. Second, production requests write to both stores and read from PostgreSQL. Third, a feature flag sends reads to DynamoDB while PostgreSQL remains available for rollback. The old store becomes read-only after the first successful day.

### 7.1 Backfill

The backfill reads orders in creation-time ranges, writes order items in batches, and records the last source primary key in a checkpoint table. It can be paused and resumed by the migration operator. The verifier samples 1% of orders and checks totals, customer IDs, line counts, and current status. A final count comparison runs before the read flag changes.

The backfill uses the same repository mapper as checkout. It does not write status summary items until the order items have passed the verifier. The summary rebuild runs after the final source count comparison.

### 7.2 Dual writes and rollback

The write path returns success when PostgreSQL succeeds. A DynamoDB write failure increments a metric and places the order ID in a retry queue. The retry consumer replays the mapper until the item is present. During dual write, reads remain on PostgreSQL so a partial DynamoDB item cannot change the API response.

Rollback clears the read flag and drains the retry queue before the next migration attempt. The operations runbook contains the feature-flag names, dashboard links, and the command for comparing the two stores. The migration window is scheduled outside the weekly fulfillment release.

## 8. Operations and open decisions

The first release creates alarms for request errors, throttled requests, latency, consumed read and write capacity, stream lag, and failed report jobs. The service dashboard separates application, fulfillment, migration, and reporting metrics. CloudTrail records table configuration changes, and the deployment role is the only role allowed to change indexes.

### 8.1 Recovery

Point-in-time recovery is enabled before any production write. The on-call runbook documents restoring to a new table and changing the repository table name through configuration. The recovery test is scheduled for the first month after cutover. The service target for a regional data-store failure remains the existing four-hour recovery objective.

### 8.2 Decision record

The team recommends approval of the one-table design and the March development cutover. The key shapes keep the implementation small, the current estimate is below the allocation, and the repository preserves the existing API contracts. The migration gates and rollback flag limit the first production change. Follow-up tuning can use the usage report after the first two weeks.
