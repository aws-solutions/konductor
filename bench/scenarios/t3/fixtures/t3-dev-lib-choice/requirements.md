# Internal Event Bus System - Requirements

## Overview
The analytics platform requires a high-throughput internal event bus to transport telemetry events between microservices. Events originate from user sessions, API calls, and system metrics, and must be processed in near real-time.

## Performance Requirements

### Throughput
- Peak load: **50,000 events per second** (sustained for up to 5 minutes during traffic spikes)
- Average load: 35,000 events per second
- Event size: Variable, but average payload is **1.2 KB** when serialized as JSON

### Latency Constraints
- End-to-end processing (ingest to storage): ≤ 250 ms P95
- Serialization/deserialization overhead: ≤ 1 ms P99 per hop
- Network transit between availability zones: ≤ 20 ms P99

### Resource Constraints
The consumer fleet has **6 CPU cores** available for event processing across all consumer services. Additional cores can be provisioned at a cost (see cost sheet).

### Network Budget
Cross-AZ network transfer is billed per GB. The budget for event bus traffic is **40 MB/s** sustained average.

### Reliability Requirements
- RPO (Recovery Point Objective): 5 minutes maximum data loss
- RTO (Recovery Time Objective): 15 minutes for full system recovery
- Availability: 99.95% uptime SLA

## Quality Attributes
- **Maintainability**: Schema evolution support required
- **Interoperability**: Must support polyglot services (Go, Python, Java)
- **Operational simplicity**: Minimal runtime dependencies
- **Monitoring**: Rich metrics for serialization performance and error rates

## Notes
- Legacy systems currently use JSON but performance is insufficient for projected growth
- A proof-of-concept tested with 25,000 events/sec (superseded by current requirements)
- Team has experience with Protocol Buffers from previous projects