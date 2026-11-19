# Ledger migration runbook

1. Confirm the primary is writable and both replicas are replaying.
2. Apply the expand migration with the database change window open. It adds the new nullable field without changing the old handler.
3. Run the prepare migration in bounded batches. Confirm the compatibility query has no remaining null `settlement_code` values.
4. Deploy application hosts in a controlled cohort. Hold each cohort long enough to inspect the dashboard and logs.
5. Apply the contract migration only after the application fleet is fully on 3.0 and the compatibility window has ended.

The operator doing the migration records the command, UTC start and finish, row count, and observed replica lag in the release record. Stop if replica lag exceeds the release gate or if the primary reports lock waits.
