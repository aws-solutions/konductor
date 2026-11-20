# Orders database manual failover

## Evidence used while preparing this procedure

The incident-time storage and commit signals are in the QuorumCtl and database logs. The candidate lag and replay checks are in the same records. The older handoff note explains why fencing must precede client routing and why a returning old primary must remain isolated.

```json
{
 "escalate": [
  "Storage Platform On-Call",
  "Orders Service Owner",
  "Orders Incident Commander",
  "Database On-Call"
 ],
 "abort": {
  "threshold": 120,
  "op": ">",
  "metric": "replication_lag_seconds"
 },
 "steps": [
  {
   "abortIf": "The cluster view is ambiguous or the lease holder is not orders-db-a.",
   "verify": {
    "evidence": [
     "logs/orders-db.log:81",
     "logs/orders-db.log:80",
     "logs/quorum-replicator.log:81",
     "logs/quorum-replicator.log:80"
    ],
    "expected": "The primary is unhealthy for database reasons, and the lease holder is still orders-db-a.",
    "check": "orders-db-a is degraded and the storage wait and commit latency signals agree with the observed write failures."
   },
   "command": "quorumctl status --cluster orders-prod",
   "action": "Correlate primary storage I/O wait with commit latency before making a role change.",
   "id": "item-1"
  },
  {
   "abortIf": "The candidate lag is greater than 120 seconds, replay is stopped, or the candidate is not promotion-eligible.",
   "verify": {
    "evidence": [
     "logs/orders-db.log:83",
     "logs/quorum-replicator.log:83",
     "logs/quorum-replicator.log:82"
    ],
    "expected": "Lag is 19 seconds at the apply check and remains below the 120-second RPO.",
    "check": "replication_lag_seconds for orders-db-b"
   },
   "command": "quorumctl inspect --node orders-db-b",
   "action": "Check replication lag and replay position on the orders-db-b candidate before promotion.",
   "id": "item-2"
  },
  {
   "abortIf": "The fence command fails, the lease remains active, or orders-db-a still accepts a connection.",
   "verify": {
    "expected": "The old lease is revoked and orders-db-a is stopped and cannot accept writes.",
    "check": "Cluster status and the node service state"
   },
   "command": "quorumctl fence --cluster orders-prod --node orders-db-a --confirm",
   "action": "Fence orders-db-a and revoke its write lease before any promotion.",
   "id": "item-3"
  },
  {
   "abortIf": "The manager refuses promotion or reports more than one lease holder.",
   "verify": {
    "expected": "orders-db-b is primary and holds the only active write lease.",
    "check": "Cluster role and lease holder"
   },
   "command": "quorumctl promote --cluster orders-prod --node orders-db-b --confirm",
   "action": "Promote the eligible orders-db-b replica after the lag and fence checks pass.",
   "id": "item-4"
  },
  {
   "abortIf": "The endpoint still resolves to orders-db-a after the TTL or clients cannot establish fresh connections.",
   "verify": {
    "expected": "orders-db.service.internal resolves to orders-db-b after 30 seconds, and clients do not use orders-db-a.",
    "check": "The client endpoint and new connection targets"
   },
   "command": "quorumctl reconfigure --service orders-api --endpoint orders-db-b",
   "action": "Repoint orders-db.service.internal to orders-db-b and allow the configured 30-second DNS TTL to expire before reopening normal traffic.",
   "id": "item-5"
  },
  {
   "abortIf": "The write fails, duplicates, or is served by the old primary.",
   "verify": {
    "expected": "The write succeeds once, the read returns the same order, and write success remains healthy.",
    "check": "A single approved test order write and read-back"
   },
   "command": "quorumctl verify --cluster orders-prod --writes",
   "action": "Verify a harmless order write and read-back through the repointed client path.",
   "id": "item-6"
  },
  {
   "abortIf": "The new primary loses its lease or the lag crosses the abort threshold.",
   "verify": {
    "expected": "orders-db-b remains the lease holder and lag stays within the data policy.",
    "check": "Role, lag, and write health"
   },
   "command": "quorumctl status --cluster orders-prod",
   "action": "Monitor the new primary, replication lag, write success, and client errors for five minutes.",
   "id": "item-7"
  },
  {
   "abortIf": "The old node accepts writes or anyone proposes reusing it before owner approval.",
   "verify": {
    "expected": "orders-db-a cannot accept writes and its volume remains intact for approved recovery.",
    "check": "Old-primary lease and service state"
   },
   "command": "quorumctl inspect --node orders-db-a",
   "action": "Keep orders-db-a fenced if it returns and inspect it without reconnecting it to the cluster.",
   "id": "item-8"
  }
 ]
}
``` 

## Abort and escalation

Do not promote if the selected candidate's replication lag exceeds the 120-second RPO, if the old primary cannot be fenced, if the candidate is not marked promotion-eligible, or if the manager reports conflicting lease holders. Keep clients on the existing route while escalating.

Page **Database On-Call**, **Orders Incident Commander**, **Orders Service Owner**, and **Storage Platform On-Call**. The storage contact is needed because the observed primary failure includes block-device wait and commit delay.

## Procedure

Run the commands as the database operator for the `orders-prod` cluster. The exact QuorumCtl syntax is kept in `vendor/quorumctl-help.txt`. Stop and escalate if an expected result is absent. Paste command output and UTC timestamps into the incident record.

1. Establish the current view and correlate primary storage I/O wait with commit latency before proceeding. A pool warning alone is not proof that the database role is unsafe.
2. Inspect `orders-db-b` and read its current replay position. It is the only normal replica eligible for this promotion.
3. Fence `orders-db-a`. Do not continue until the lease is revoked and the database service is stopped on the old primary.
4. Promote `orders-db-b` only after the lag and fence checks pass. Confirm that the manager reports it as the new lease holder and primary.
5. Repoint the client service to the new primary. Wait through the 30-second DNS TTL and confirm fresh connections use `orders-db-b`.
6. Run the write-path check. Submit a harmless order write in the approved test account, read it back, and confirm the write succeeds exactly once.
7. Watch lag, write success, and error rate for five minutes. Keep the old primary fenced while the new primary serves traffic.
8. If `orders-db-a` returns, leave it fenced and inspect it without reconnecting it to the cluster. Do not reuse its volume until the database owner approves recovery.

## Use this at 03:00

This procedure moves the write role from an unhealthy `orders-db-a` to the eligible replica in the other zone. It protects the 120-second recovery point objective and prevents a recovered old primary from accepting writes. The database on-call owns the role change. The incident commander controls communications.

### Before touching the cluster

Page the database and service contacts listed below. Record the incident start time in UTC. Keep the current primary available for inspection until the fencing action. Do not promote a node just because the API has errors. Correlate database health, storage wait, lease state, and replication lag.

The current eligible candidate is `orders-db-b` in `zone-blue`. `orders-db-c` is a 900-second delayed backup copy in `zone-green` and must never receive production writes. The client endpoint is `orders-db.service.internal:6432`; its DNS TTL is 30 seconds.
