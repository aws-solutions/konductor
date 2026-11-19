# Design Review: Notification Fanout Service

**Reviewer:** Senior Platform Engineer  
**Date:** March 10, 2024  
**Status:** Review Complete

## Overall Assessment

The design presents a solid foundation for replacing the legacy cron-based notification system with a modern, event-driven architecture. The move to Kafka for durable message storage and stateless workers is appropriate for the scale requirements. However, several critical gaps in failure handling, data protection, and capacity planning need addressing before proceeding to implementation.

The most significant risks are: (1) lack of deduplication will cause repeat incidents of user-facing duplicate notifications, (2) unencrypted user contact data in queues violates compliance requirements, and (3) missing throttling against vendor rate limits could lead to service blacklisting during peak loads.

## Key Findings

### Data Protection and Compliance
User contact data (device tokens, email addresses) being stored unencrypted in Kafka for 30 days creates a compliance violation. The service-targets.md document explicitly requires encryption of all user data at rest. This is particularly concerning given GDPR and CCPA requirements for handling personal data.

### Duplicate Notification Risk
The January incident report clearly demonstrated the user impact of duplicate notifications - erosion of trust, increased support load, and app uninstall spikes. The design's lack of deduplication mechanism combined with at-least-once delivery semantics guarantees this issue will recur. Idempotency keys or consumer-side deduplication must be implemented.

### Vendor Rate Limit Management
The design mentions vendor rate limits but provides no mechanism to enforce them. With SendGrid limited to 100 emails/second and peak traffic projected at 500 notifications/second (30% email mix = 150 emails/second), the system will exceed vendor limits during normal operation. This could result in throttling, blacklisting, or additional costs.

### Capacity Planning Disconnect
The 10,000 notifications/second design capacity is 20x the current peak of 500/second shown in traffic-by-hour.csv. While future-proofing is good, such over-provisioning without justification suggests insufficient analysis of actual growth projections and cost implications.

### Availability Architecture
Achieving 99.95% availability (~4.38 hours downtime/year) with single-zone deployment is unrealistic. AWS availability zones have historically experienced outages lasting hours. Multi-zone deployment is necessary for this SLA.

### Retry Storm Risk
Unbounded retries with exponential backoff but no maximum attempts or dead-letter queue creates a retry storm risk during vendor outages. Messages will continuously retry, consuming resources and potentially masking the underlying issue.

### User Experience Gaps
Hardcoding quiet hours to US/Eastern timezone ignores global user base and individual preferences. The system should respect user-configured time zones and quiet hour preferences.

## Detailed Findings

```json
[
  {
    "location": "5.3.3",
    "severity": "high",
    "issue": "Consumers lack deduplication mechanism, which combined with at-least-once delivery will cause duplicate notifications as documented in the January incident report.",
    "fix": "Implement idempotency keys or consumer-side deduplication with a 24-hour window."
  },
  {
    "location": "5.3.2",
    "severity": "medium",
    "issue": "Retry logic has no cap and no dead-letter queue, meaning vendor outages could create infinite retry storms that overwhelm the system.",
    "fix": "Add maximum retry limit (e.g., 5 attempts) and dead-letter queue for failed notifications."
  },
  {
    "location": "5.5",
    "severity": "medium",
    "issue": "Design capacity of 10,000 notifications/sec is 20x the current peak of 500/sec shown in traffic-by-hour.csv, with no justification for such over-provisioning.",
    "fix": "Re-evaluate capacity planning based on traffic analysis of actual peak load projections."
  },
  {
    "location": "5.4.2",
    "severity": "high",
    "issue": "SendGrid limit is 100 emails/sec per vendor-limits.yaml, but the design doesn't include throttling mechanisms to prevent exceeding this limit.",
    "fix": "Implement rate limiting per vendor with queue buffering for exceeded limits."
  },
  {
    "location": "5.7.1",
    "severity": "critical",
    "issue": "User contact data (device tokens, email addresses) is included in each queued event and stored for 30 days without encryption, violating data protection requirements in service-targets.md.",
    "fix": "Encrypt PII and contact data for data protection, referencing user IDs instead of copying sensitive information."
  },
  {
    "location": "5.6",
    "severity": "medium",
    "issue": "99.95% availability target requires multi-zone deployment, but the design specifies single availability zone in us-east-1.",
    "fix": "Design for multi-zone deployment or adjust availability target to match single-zone capabilities."
  },
  {
    "location": "5.8",
    "severity": "low",
    "issue": "Quiet hours implementation uses hardcoded US/Eastern timezone instead of respecting individual user time zones and preferences.",
    "fix": "Use user timezone preferences and implement per-user quiet hour configuration."
  }
]
```