# Design review

**Verdict: do not approve for the March cutover yet.** The proposal is readable and preserves useful API and rollback boundaries, but several access paths conflict with the stated traffic, item limits, event contract, or monthly allocation. The primary key and order representation can fail on the launch path, while the customer and reporting reads create unbounded work. The status summary also loses correctness under the duplicate delivery behavior already supported by the service.

The team should resolve the storage shape and access paths before load testing. A load test against the proposed date key or a small sample will not demonstrate safety at the 1,800 writes/second launch peak, the 126,400-order customer, the 774 KB observed item, or the projected 1.1 TB reporting table. The cost model should be rerun from the corrected access patterns and should include migration and reporting growth.

## Findings

### 3.2, critical: date-only partition key creates a hot partition

All launch writes are assigned to `ORDER#2025-02-18` or the equivalent current date. The traffic forecast says 1,800 writes/second, while the service limits give a 1,000 writes/second on-demand partition baseline and say 92% of peak traffic lands on that date. On a promotion, this can throttle checkout and raise p95 latency. Use a sharded partition key, such as a bounded write shard derived from order ID, and retain date in the sort key or a queryable attribute. Exercise the write distribution at the launch peak before cutover.

### 3.3, high: customer history has no key-based access path

The repository scans the table and filters by customer ID, then sorts matching results. That is an unbounded read for a 2,400-requests/second endpoint and can walk a large table for the customer with 126,400 orders. It also makes a 20-item page expensive as the table grows. Add a customer index with a partition key for the customer and a descending time sort key, or add a customer-history item collection that supports a DynamoDB Query and cursor pagination. The request must read only the authenticated customer scope.

### 4.1, medium: GSI1 projects far more data than the consumer reads

The fulfillment path reads only `orderId`, `customerId`, and `updatedAt`, but `ALL` copies every order attribute, including the line list, into the index. The cost plan separately estimates GSI request and storage cost, and the full projection duplicates the large order payload on every index write. Change the projection to `INCLUDE` for the three required attributes, or `KEYS_ONLY` if the repository can fetch the small summary fields from the base item. Recalculate index storage and write cost after the projection change.

### 3.4, critical: line list exceeds the DynamoDB item limit

The document's own arithmetic gives a 6 KB header plus 640 lines at 1.2 KB each, or about 774 KB, while the service limit is 400 KB. The API also has a planned 1,200-line bulk customer. The PutItem therefore cannot represent observed orders, and the API's 500-line request cap does not cover the observed data or the next-quarter contract. Split line items into separately keyed items, or reject and renegotiate the bulk contract before migration; define how detail reads page or assemble those items and test the maximum supported order size.

### 3.5, high: summary counter update is neither atomic nor duplicate-safe

A read followed by PutItem allows concurrent workers to overwrite one another's increments. The status-event contract also permits redelivery and requires an already-applied event to be idempotent, but this path adds or subtracts for every delivery and does not condition the transition on the expected version or event ID. Use a conditional update or an atomic `ADD` with a condition, and record event IDs or use the order's version in the same transaction so duplicate and out-of-order events cannot corrupt the count. Add a concurrent-worker and redelivery test before relying on the reconciliation job.

### 6.3, high: hourly full scans cannot meet the reporting budget at growth

The job reads the entire table every hour, while the cost plan allocates only 280 USD per month for DynamoDB reporting reads and assumes a 250 GB table. The design itself projects 1.1 TB within 18 months. Repeating a full 250 GB scan, and later a 1.1 TB scan, produces an unbounded read workload and cannot remain within the 400 USD reporting allocation. Use an incremental export or change stream into a reporting table or object-store dataset, keyed by the report watermark, and define how late status updates are included. Rework the cost model with current and 18-month volumes and measure report completeness.

```json
[
  {
    "location": "3.2",
    "severity": "critical",
    "issue": "The date-only partition key concentrates 1,800 launch writes per second on one partition despite the 1,000 writes per second partition baseline.",
    "fix": "Add a sharded partition key and test write distribution at the launch peak."
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "Customer history uses a filtered table scan with no key or index for a 2,400 requests per second endpoint and customers with 126,400 orders.",
    "fix": "Add a customer index with a time sort key and query it with cursor pagination."
  },
  {
    "location": "4.1",
    "severity": "medium",
    "issue": "GSI1 projects ALL attributes even though fulfillment reads only three fields, duplicating large line-bearing items and inflating index write and storage cost.",
    "fix": "Use an INCLUDE projection for the required attributes or KEYS_ONLY, then recalculate cost."
  },
  {
    "location": "3.4",
    "severity": "critical",
    "issue": "The observed 774 KB order and planned 1,200-line order exceed DynamoDB's 400 KB item size limit when line items remain in one list.",
    "fix": "Split line items into separate items and define paged detail reads, or reject the bulk contract."
  },
  {
    "location": "3.5",
    "severity": "high",
    "issue": "Read-then-write summary updates lose concurrent increments and count redelivered events because they lack an atomic conditional update and event-id idempotency.",
    "fix": "Use an atomic conditional update and record event IDs or the order version in a transaction."
  },
  {
    "location": "6.3",
    "severity": "high",
    "issue": "An hourly full-table scan grows from 250 GB toward 1.1 TB and cannot fit the 400 USD reporting allocation.",
    "fix": "Use an incremental export or reporting table with a watermark and recalculate the growth cost."
  }
]
```