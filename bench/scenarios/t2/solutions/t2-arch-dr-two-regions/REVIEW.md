# Design Review: Active-Active TicketBooking Migration

## Overall Assessment

The design demonstrates a reasonable approach to achieving active-active deployment across two regions, with clear benefits for availability and latency. However, several critical gaps in the data consistency model, recovery procedures, and cost estimation require addressing before proceeding.

**Primary Risks:**
1. Data consistency issues could lead to double booking of seats, violating core business rules
2. Recovery time and point objectives may not be achievable with the proposed architecture
3. Cost underestimation could impact budget approval and project viability
4. Missing operational procedures for failback and data reconciliation

## Detailed Findings

### Data Consistency and Conflict Resolution
The proposed last-write-wins conflict resolution is fundamentally incompatible with the ticket booking domain where double booking must be prevented. The design acknowledges that seat counts could go negative but treats this as an alert condition rather than preventing it. Stronger consistency mechanisms or application-level coordination are needed.

### Recovery Objectives vs. Reality
Measured replication lag shows P99 values exceeding 60 seconds, yet the RPO target is 60 seconds. This mismatch guarantees data loss will exceed the target during replication spikes. Similarly, DNS TTL + health check timing exceeds the 60-second RTO, making the recovery time objective unachievable.

### Budget and Cost Planning
The budget analysis appears incomplete, missing the doubled database costs for the second region and underestimating cross-region data transfer expenses. The variance calculation shows the project already exceeds budget before accounting for these omissions.

### Operational Gaps
The failback procedure lacks specificity about data consistency verification, gradual traffic shifting, and monitoring during transition. Without detailed steps, operators may cause data corruption or service disruption during recovery operations.

### Global Counters Without Merge Logic
Maintaining a global seat counter that both regions can update independently, with only last-write-wins conflict resolution, will inevitably lead to inventory discrepancies. The design needs explicit merge semantics or a centralized coordination mechanism.

## Recommendations

1. **Replace last-write-wins** with a stronger consistency model for seat inventory, such as reservation tokens or distributed locks
2. **Adjust recovery targets** to match achievable metrics based on replication lag measurements and DNS behavior
3. **Revise budget** to include full infrastructure costs and add contingency for cross-region data transfer
4. **Detail failback procedures** with specific verification steps, traffic shifting controls, and rollback plans
5. **Implement inventory coordination** through a consensus protocol or centralized inventory service

The design shows good foundational work but requires substantial revisions to the data consistency and recovery architecture before implementation.

```json
[
  {
    "location": "3.2",
    "severity": "critical",
    "issue": "Last-write-wins conflict resolution allows the same seat to be sold in both regions, violating the core business rule against double booking.",
    "fix": "Implement stronger conflict resolution such as reservation tokens or application-level coordination to prevent double booking"
  },
  {
    "location": "6.3",
    "severity": "high",
    "issue": "The claimed RPO of 60 seconds in section 6.3 is smaller than the measured replication lag which exceeds 60 seconds at P99, meaning data loss could exceed the recovery target.",
    "fix": "Adjust RPO target to match actual replication capabilities or implement synchronous replication for critical data"
  },
  {
    "location": "6.2",
    "severity": "high",
    "issue": "DNS TTL of 300 seconds plus health check timing of 60 seconds exceeds the 60-second RTO stated in section 6.2, meaning failover will take longer than the recovery target.",
    "fix": "Reduce DNS TTL to 30 seconds and implement faster health checks or consider alternative routing mechanisms"
  },
  {
    "location": "8.1",
    "severity": "medium",
    "issue": "The budget allocation in section 8.1 omits the doubled database cost for the second region and underestimates cross-region data transfer costs.",
    "fix": "Update budget to include full RDS instance costs for us-west-2 and increase cross-region transfer estimates based on measured traffic patterns"
  },
  {
    "location": "7.1",
    "severity": "medium",
    "issue": "The failback procedure in section 7.1 is vague and missing detailed steps for verifying data consistency before returning traffic to the restored region.",
    "fix": "Create detailed failback runbook with data consistency checks, gradual traffic shifting, and rollback procedures"
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "A global seats-left counter updated in both regions with no merge rule will cause inventory discrepancies and potential overselling.",
    "fix": "Implement proper merge semantics for concurrent updates or use a centralized inventory service with strong consistency"
  },
  {
    "location": "6.1",
    "severity": "medium",
    "issue": "The estimated recovery time in section 6.1 doesn't account for DNS propagation delay beyond TTL, which could extend the actual outage duration.",
    "fix": "Update recovery time estimates to include DNS propagation and client caching behavior beyond TTL"
  },
  {
    "location": "2.2",
    "severity": "low",
    "issue": "Asynchronous replication contradicts the strong consistency requirement for seat inventory stated in the product rules, creating dependency compatibility issues.",
    "fix": "Use synchronous replication for seat inventory tables or implement application-level consistency guarantees"
  }
]
```