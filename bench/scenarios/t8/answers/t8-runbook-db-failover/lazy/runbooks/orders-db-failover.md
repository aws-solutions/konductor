# Orders database manual failover

## Use this at 03:00

This procedure moves the write role from an unhealthy `orders-db-a` to the eligible replica in the other zone. It protects the 120-second recovery point objective and prevents a recovered old primary from accepting writes. The database on-call owns the role change. The incident commander controls communications.

### Before touching the cluster

Page the database and service contacts listed below. Record the incident start time in UTC. Keep the current primary available for inspection until the fencing action. Do not promote a node just because the API has errors. Correlate database health, storage wait, lease state, and replication lag.

## Procedure

Run the commands as the database operator for the `orders-prod` cluster. The exact QuorumCtl syntax is kept in `vendor/quorumctl-help.txt`. Stop and escalate if an expected result is absent. Paste command output and UTC timestamps into the incident record.

## Abort and escalation

Do not promote if the selected candidate's replication lag exceeds the 120-second RPO, if the old primary cannot be fenced, if the candidate is not marked promotion-eligible, or if the manager reports conflicting lease holders. Keep clients on the existing route while escalating.

## Evidence used while preparing this procedure

The incident-time storage and commit signals are in the QuorumCtl and database logs. The candidate lag and replay checks are in the same records. The older handoff note explains why fencing must precede client routing and why a returning old primary must remain isolated.

```json
{
 "steps": [
  {
   "id": "observe-primary",
   "action": "Correlate primary storage I/O wait with commit latency before making a role change.",
   "command": "quorumctl status --cluster orders-prod",
   "verify": {
    "check": "orders-db-a is degraded and the storage wait and commit latency signals agree with the observed write failures.",
    "expected": "The primary is unhealthy for database reasons, and the lease holder is still orders-db-a.",
    "evidence": [
     "logs/quorum-replicator.log:80",
     "logs/quorum-replicator.log:81",
     "logs/orders-db.log:80",
     "logs/orders-db.log:81"
    ]
   },
   "abortIf": "The cluster view is ambiguous or the lease holder is not orders-db-a."
  },
  {
   "id": "check-candidate-lag",
   "action": "Check replication lag and replay position on the orders-db-b candidate before promotion.",
   "command": "quorumctl inspect --node orders-db-b",
   "verify": {
    "check": "replication_lag_seconds for orders-db-b",
    "expected": "Lag is 19 seconds at the apply check and remains below the 120-second RPO.",
    "evidence": [
     "logs/quorum-replicator.log:82",
     "logs/quorum-replicator.log:83",
     "logs/orders-db.log:83"
    ]
   },
   "abortIf": "The candidate lag is greater than 120 seconds, replay is stopped, or the candidate is not promotion-eligible."
  },
  {
   "id": "fence-old-primary",
   "action": "Fence orders-db-a and revoke its write lease before any promotion.",
   "command": "quorumctl fence --cluster orders-prod --node orders-db-a --confirm",
   "verify": {
    "check": "Cluster status and the node service state",
    "expected": "The old lease is revoked and orders-db-a is stopped and cannot accept writes."
   },
   "abortIf": "The fence command fails, the lease remains active, or orders-db-a still accepts a connection."
  },
  {
   "id": "promote-candidate",
   "action": "Promote the eligible orders-db-b replica after the lag and fence checks pass.",
   "command": "quorumctl promote --cluster orders-prod --node orders-db-b --confirm",
   "verify": {
    "check": "Cluster role and lease holder",
    "expected": "orders-db-b is primary and holds the only active write lease."
   },
   "abortIf": "The manager refuses promotion or reports more than one lease holder."
  }
 ],
 "abort": {
  "metric": "replication_lag_seconds",
  "op": ">",
  "threshold": 84
 },
 "escalate": [
  "Database On-Call",
  "Orders Incident Commander",
  "Orders Service Owner",
  "Storage Platform On-Call"
 ]
}
``` 
