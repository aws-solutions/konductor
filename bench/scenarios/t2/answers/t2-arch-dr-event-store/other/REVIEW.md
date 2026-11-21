# Review of ADR-0007 (event-sourced orders)

**Verdict: not ready.** Approve the two-week spike only. Recovery time and read-after-write visibility must be fixed
before the council sees a full approval request.

## What blocks approval

Recovery does not fit the 15-minute objective. Section 6.2 rounds the event count to 174.7 million and says a full
replay takes ten minutes. At 2.5 million events per minute, 174.66 million events take close to 70 minutes. The ADR also
assumes five minutes for restore and startup, but the packet's own restore exercise takes 11 minutes. So restore alone
uses 11 of the 15 minutes, and almost nothing is left for a rebuild.

A customer who places an order may not see it. The constraints in 2.3 and the read path in 3.3 serve the detail page
from a projection that "normally" catches up in two seconds. The product requirement is that a successful placement is
visible at once. How will the first read after a write be fresh?

Personal data cannot be deleted. Events carry the customer id, the delivery address and sometimes contact details
(3.5), the log is kept for ever, and the deletion worker only clears projections.

## Other gaps

- Checkpoints need a global position. The key is `(order_id, sequence)`, so there is no commit-ordered position across
  orders, and a cursor can skip a row that commits late.
- Monthly partitions (4.1) do not fit the `(order_id, sequence)` key: PostgreSQL needs the partition column in the key,
  and one order's stream then spans partitions.
- A poison event stops its projection; the ADR does not say whether it is parked, skipped or blocks the whole view.
- There is no cost figure against the 2,400 USD per month first-year budget.
- The flag rollout writes the legacy tables from the asynchronous projection, so legacy readers lag and a rollback
  rebuilds them from a view that lacks some of their fields.
- Overnight, only platform is on call, and platform cannot own an order-specific replay.
- The backfill gives a state-capture event where audit rows lack old values; parity can only be current-state parity.
- The relay publishes `OrderPlaced`, `OrderCancelled` and `OrderUpdated` today; the ADR maps only `OrderPlaced`.

```json
{"findings": [
  {"location": "Section 6.2", "severity": "critical",
   "issue": "174.66 M events at 2.5 M per minute is about 70 minutes, not ten, and restore takes 11 minutes, so the 15-minute RTO fails.",
   "fix": "Recalculate the recovery time and bound it with snapshots or incremental rebuild so it meets the RTO."},
  {"location": "Section 2.3", "severity": "critical",
   "issue": "The detail page reads a projection that may lag, but the product says a placed order is visible at once.",
   "fix": "Read after write from the event store for the writer, or wait for the projection to pass the write's position."},
  {"location": "Section 3.5", "severity": "critical",
   "issue": "Customer id, address and contact details sit in an append-only log kept for ever; deleting projections does not erase them.",
   "fix": "Keep personal data out of events or encrypt it per customer and crypto-shred the key on deletion."},
  {"location": "Section 3.2", "severity": "high",
   "issue": "Events live for the life of the service with only optional fields as the change rule.",
   "fix": "Add an event version field and upcast old events on read, with tests over stored history."},
  {"location": "Section 7.1", "severity": "high",
   "issue": "Reporting loses direct SQL, current-day questions, seven-year reproducibility and the full audit fields.",
   "fix": "Keep SQL access through a read replica or a reporting schema with a published contract and 60 days' notice."},
  {"location": "Section 5.1", "severity": "medium",
   "issue": "The options table reduces CRUD to current state only, though the service already has an outbox and an audit table.",
   "fix": "Compare against keeping the outbox and audit table with better contracts."},
  {"location": "Section 4.1", "severity": "medium",
   "issue": "Snapshots are left to the spike with no rule for when they are taken or how they are kept.",
   "fix": "Write a snapshot policy: interval, storage, retention and how a write coordinates with the stream version."}
]}
```
