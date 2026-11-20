# Orders database: manual failover (orders-db-a to orders-db-b)

Use this when orders-db-a, the primary, is unhealthy. Database On-Call owns every promotion and fencing decision.
Time limit: 15 minutes from the page (the RTO). If a check fails, stop and page Database On-Call; do not push on.

Hard stop: if `replication_lag_seconds` on orders-db-b is above 120 s (the RPO), do not promote. Keep writes fenced,
page Database On-Call, and never discard unapplied WAL. Never promote orders-db-c: it is a 900 s delayed copy.

1. **Confirm the fault is the primary.** `quorumctl inspect --node orders-db-a`. Expect high
   `storage_io_await_ms` (the 02:07 log shows 1,840 ms). If the database is healthy and only the API is failing, this
   is not a failover; page the Orders Service Owner.
2. **Check the candidate.** `quorumctl status --cluster orders-prod`. Expect orders-db-b eligible with lag at most 120 s.
3. **Fence the old primary.** `quorumctl fence --cluster orders-prod --node orders-db-a --confirm`. Then run status
   again and expect the old lease shown as revoked. If the node is unreachable, wait at least the 45 s lease. No
   revoked lease: stop.
4. **Promote.** `quorumctl promote --cluster orders-prod --node orders-db-b --confirm`. Expect orders-db-b as lease
   holder.
5. **Move clients.** `quorumctl reconfigure --service orders-api --endpoint orders-db-b`. Wait the 30 s DNS TTL, then
   have the Orders Service Owner recycle the orders-api pools so no socket stays on orders-db-a.
6. **Prove writes.** `quorumctl verify --cluster orders-prod --writes`. Expect a test write and its read-back to succeed.
7. **Watch.** For 10 minutes, watch lag, write success, pool use and read latency.
8. **Leave orders-db-a alone.** Keep it isolated; do not rejoin or reuse it. Its volume stays intact until the database
   owner confirms the incident record and recovery copy; only then rebuild it as a replica.

```json
{
  "escalate": ["Database On-Call", "Orders Service Owner", "Storage Platform On-Call", "Orders Incident Commander"],
  "abort": {"metric": "replication_lag_seconds", "op": ">=", "threshold": 120},
  "steps": [
    {"id": "s1-confirm-fault", "action": "Confirm orders-db-a itself is unhealthy: storage wait and commit latency, not only API errors.", "command": "quorumctl inspect --node orders-db-a", "verify": "storage_io_await_ms on orders-db-a is far above normal (1840 ms in the log).", "abortIf": "orders-db-a is healthy; the fault is elsewhere."},
    {"id": "s2-candidate", "action": "Read replica lag for the orders-db-b candidate; it must be caught up within the RPO.", "command": "quorumctl status --cluster orders-prod", "verify": "orders-db-b is eligible and its lag is at most 120 s.", "abortIf": "Lag above 120 s or orders-db-b not eligible."},
    {"id": "s3-fence", "action": "Fence orders-db-a so it cannot take writes.", "command": "quorumctl fence --cluster orders-prod --node orders-db-a --confirm", "verify": "Status shows the orders-db-a lease revoked.", "abortIf": "Lease not revoked after 45 s."},
    {"id": "s4-promote", "action": "Promote orders-db-b.", "command": "quorumctl promote --cluster orders-prod --node orders-db-b --confirm", "verify": "orders-db-b is the only lease holder.", "abortIf": "Promotion refused or two lease holders."},
    {"id": "s5-clients", "action": "Point orders-api at orders-db-b and wait the 30 s DNS TTL before reopening traffic.", "command": "quorumctl reconfigure --service orders-api --endpoint orders-db-b", "verify": "orders-db.service.internal resolves to orders-db-b after 30 s and new pool connections go there.", "abortIf": "Still resolving to orders-db-a after 30 s."},
    {"id": "s6-recycle", "action": "Recycle the orders-api connection pools so no open socket stays on the old primary.", "command": "console: restart orders-api pool (Orders Service Owner)", "verify": "Pool in-use connections all target orders-db-b.", "abortIf": "Connections still open to orders-db-a."},
    {"id": "s7-writes", "action": "Prove a real write: a test write and a read of it back.", "command": "quorumctl verify --cluster orders-prod --writes", "verify": "The write check passes and orders_write_success_rate recovers.", "abortIf": "Write fails or lands on orders-db-a."},
    {"id": "s8-watch", "action": "Watch lag, write success, pool use and read latency for 10 minutes.", "command": "quorumctl status --cluster orders-prod", "verify": "orders-db-b keeps the lease and lag stays under 120 s for the whole window.", "abortIf": "Lease lost or lag over 120 s."},
    {"id": "s9-old-primary", "action": "Keep orders-db-a isolated; do not rejoin it. Keep its volume until the database owner approves.", "command": "quorumctl inspect --node orders-db-a", "verify": "orders-db-a holds no lease and its volume is untouched.", "abortIf": "Anyone tries to restart or reuse orders-db-a before approval."}
  ]
}
```
