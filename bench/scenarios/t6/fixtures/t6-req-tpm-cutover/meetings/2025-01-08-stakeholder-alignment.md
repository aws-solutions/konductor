# Stakeholder Alignment Meeting

**Date**: 2025-01-08
**Time**: 14:00 - 15:30 UTC
**Lead**: Maya Chen

## Attendees
- Sarah Johnson (VP Engineering)
- Maya Chen (TPM)
- Alex Rodriguez (Platform)
- Jamie Wilson (Security)
- Samir Patel (Order API)
- Lisa Wong (Payment)
- Tom Harris (Fulfillment)

## Discussion Points

### 1. Migration Timeline
- Sarah: "We must complete by June 15 contract end, but prefer earlier to avoid last-minute rush."
- Alex: "Technical work can be done by April, but need 4 weeks buffer for unexpected issues."
- Consensus: Target April cutover, with May as contingency.

### 2. Downtime Tolerance
- Sarah: "What's the maximum acceptable downtime?"
- Lisa: "Payment processing can't be down more than 10 minutes during business hours."
- Tom: "Fulfillment can tolerate 30 minutes if planned for weekend."
- Sarah: "Let's aim for <5 minutes, plan for <30 as worst case."

### 3. Rollback Strategy
- Jamie: "From the incident, we need clear rollback triggers."
- Alex: "Suggest time-based: if not fully operational in 30 minutes, rollback automatically."
- Maya: "Need business sign-off on what 'fully operational' means."

### 4. Communication Requirements
- Sarah: "Customers need 2 weeks notice for maintenance."
- Legal: Requires 30-day notice for SLA changes.
- Marketing: Can help with customer communications.

### 5. Budget Approval
- Sarah: "AWS costs approved up to $2,500/month."
- Finance: Needs final numbers by Jan 31 for Q2 budgeting.

## Decisions
1. **Cutover window**: Weekend, outside business hours (US/EMEA overlap minimal)
2. **Maximum downtime**: 30 minutes from business perspective
3. **Rollback trigger**: 30 minutes from cutover start if not operational
4. **Communication**: 14-day customer notice required
5. **Budget**: $2,500/month cap for Kafka

## Action Items
- [Maya] Draft cutover requirements document
- [Alex] Provide final cost estimate by Jan 20
- [Jamie] Define security sign-off criteria
- [All] Review and comment on requirements by Jan 25

## Next Meeting
2025-01-22: Review requirements draft