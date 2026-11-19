# Code Review: PR #77 - Fulfilment Status Tracking

Overall, this PR adds useful functionality but introduces several serious issues that would break production during rolling deployment or cause performance problems at scale. The migration approach is unsafe for our 2.5M row production table, and the reporting code has both security and performance issues.

## Critical Issues

**Rolling deployment breakage**: The migration adds a NOT NULL column with a DEFAULT, but during rolling deployments, old code will still be running and attempting INSERT statements without the new column. In SQLite, DEFAULT values only apply when the column is explicitly omitted from the INSERT statement. If old code uses explicit column lists (as our repository does), the INSERT will fail.

**Production table locking**: The backfill UPDATE runs in a single transaction against the entire 2.5M row table, which will lock it for an unacceptable duration and likely cause application timeouts.

**SQL injection vulnerability**: The report repository builds SQL with string formatting from user parameters, creating a clear SQL injection path.

## Findings

```json
[
  {
    "location": "src/orders/migrations/migration_003_add_fulfilment_status.py:8",
    "severity": "critical",
    "issue": "Column added as NOT NULL with a default, but during rolling deployment old code inserting without this column will fail because DEFAULT only works if column is explicitly omitted from INSERT.",
    "fix": "Make column nullable initially, backfill, then add NOT NULL constraint in separate migration after deployment completes."
  },
  {
    "location": "src/orders/migrations/migration_003_add_fulfilment_status.py:14",
    "severity": "high",
    "issue": "UPDATE affects entire table in one transaction, which will lock the 2.5M row production table for too long and could cause timeouts.",
    "fix": "Batch the update in chunks of 10k rows with pauses between batches."
  },
  {
    "location": "src/orders/migrations/migration_003_add_fulfilment_status.py:29",
    "severity": "medium",
    "issue": "Down migration drops column without warning about data loss, violating migration safety principles documented in deployment.md.",
    "fix": "Add warning comment and consider preserving data or making down migration fail if column contains non-default values."
  },
  {
    "location": "src/orders/report_repository.py:23",
    "severity": "high",
    "issue": "SQL query built with string formatting from user parameter, creating SQL injection vulnerability in get_fulfilment_summary method.",
    "fix": "Use parameterized query with proper WHERE clause construction."
  },
  {
    "location": "src/orders/report_repository.py:48",
    "severity": "medium",
    "issue": "get_customer_fulfilment_details runs N+1 queries (one per order), which will be extremely slow with many orders.",
    "fix": "Rewrite to use a single JOIN query or batch the detail retrieval."
  },
  {
    "location": "src/orders/report_repository.py:74",
    "severity": "medium",
    "issue": "find_orders_by_fulfilment_date_range filters by fulfilment_status and created_at range but lacks a composite index, causing full scans on large table.",
    "fix": "Add composite index on (fulfilment_status, created_at) for this query pattern."
  },
  {
    "location": "src/orders/migrations/migration_003_add_fulfilment_status.py:22",
    "severity": "low",
    "issue": "Index created with standard CREATE INDEX which locks table during creation on large production dataset.",
    "fix": "Schedule index creation during maintenance window or use online index creation if supported."
  }
]
```