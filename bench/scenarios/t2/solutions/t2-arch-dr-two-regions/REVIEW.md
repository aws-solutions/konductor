# Design Review: Active-Active TicketBooking Migration

## Overall Assessment

The design should not go ahead as written. Seat inventory can be sold twice, the recovery targets do not match the service targets or the measured data, and the cost case is incomplete.

## Detailed Findings

### Seats can be sold twice
Both regions write the seat counter and last-write-wins picks one write. In Scenario 1 (3.3) two customers buy seat A-12 and the counter still reads 0, so nothing alerts. The service targets allow zero double bookings and require strong consistency for ticket inventory and payments; asynchronous replication (3.2) cannot give that.

### Recovery targets
The design's RPO is 60 seconds; the service target for transactional data is 30 seconds. The measured P99 lag is 420-720 ms against a < 100 ms target. The design names three recovery times (120 s in 3.2, 90 s in 3.6, 60 s in 6.2), and with a 300-second DNS TTL none of them can hold.

### Cost
Storage is priced once for two databases, Multi-AZ standbys are left out, and the one-time cost is already over the approved budget.

### Failback
The failback steps do not say how to check consistency or how to reconcile writes taken during the outage.

```json
[
  {
    "location": "3.3",
    "severity": "critical",
    "issue": "Both regions update the seat inventory counter, and last-write-wins resolves the conflict, so the same seat can be sold in both regions: Scenario 1 in 3.3 ends with two buyers for seat A-12 while the counter reads 0. That breaks the zero-tolerance double-booking rule; the counter needs one writer, a conditional reservation or a merge rule.",
    "fix": "Give the seat counter a single writer per event or a conditional reservation, so a seat is sold once; prevent double booking instead of alerting on it."
  },
  {
    "location": "6.3",
    "severity": "high",
    "issue": "The recovery targets do not match the service targets or the data: the design's RPO of 60 seconds (3.2, 6.3) is twice the 30-second RPO service-targets.md sets for transactional data, and the measured P99 replication lag (420-720 ms, max 2.2 s) is 4-7 times the design's own < 100 ms P99 lag target and success criterion 4.",
    "fix": "Set the RPO to the 30-second service target, alert on the measured P99 lag, and either fix the lag target to the measured 420-720 ms or replicate seat and payment writes synchronously."
  },
  {
    "location": "6.2",
    "severity": "high",
    "issue": "A DNS TTL of 300 seconds (3.5, dns-config.json) means clients keep resolving the failed region for up to 5 minutes after Route 53 changes, so failover cannot meet the 60-second RTO; the 6.2 breakdown counts only 20 seconds for DNS propagation.",
    "fix": "Lower the DNS TTL to 30-60 seconds (or use a global accelerator) and recompute the 6.2 breakdown with TTL and health check time."
  },
  {
    "location": "3.9",
    "severity": "medium",
    "issue": "The cost analysis (3.9, with no figures in 8.1) prices 1 TB of database storage once although each of the two RDS instances needs it, leaves out the Multi-AZ standbys, and its one-time total ($48,000; $47,400 in budget-breakdown.yaml) already exceeds the $45,000 approved budget.",
    "fix": "Price storage for both RDS instances, add the Multi-AZ standby cost, and bring the one-time cost under budget or ask for a larger budget."
  },
  {
    "location": "7.1",
    "severity": "medium",
    "issue": "The failback steps (3.7, 7.1) say only 'verify replication has caught up'; they give no check or pass criterion and no step to reconcile writes the surviving region accepted while the other was down, so returning traffic can reintroduce conflicting seat and payment rows.",
    "fix": "Add failback steps: compare row counts and checksums for seats and payments, reconcile writes taken during the outage, and set a pass criterion before shifting traffic."
  },
  {
    "location": "3.6",
    "severity": "medium",
    "issue": "The design states three different recovery times: RTO 120 seconds in 3.2, an estimated 90 seconds in 3.6 and a 60-second RTO in 6.2, so there is no single target to build or test against; only 60 seconds matches service-targets.md.",
    "fix": "Pick one RTO (60 seconds, the service target), use it in 3.2, 3.6 and 6.2, and test failover against it."
  },
  {
    "location": "3.2",
    "severity": "high",
    "issue": "Asynchronous replication with eventual consistency for seat counts (3.2, 3.3) contradicts the strong consistency service-targets.md requires for ticket inventory and for payment records.",
    "fix": "Keep seat inventory and payments on synchronous or single-writer storage to meet the strong consistency requirement; leave asynchronous replication for the rest."
  }
]
```
